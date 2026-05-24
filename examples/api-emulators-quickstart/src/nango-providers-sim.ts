// Nango providers — 3-month cross-provider simulation with FULL endpoint
// coverage.
//
// Seeds 10 connections, each carrying ~90 days of dated records. Four
// (xero, quickbooks, google-drive, onedrive) drive the provider-native
// `/proxy/*` paths; the rest form a *cross-provider graph* where records
// reference each other by real id + share URL:
//
//   google-drive  ── canonical asset store (images + proposal/report docs)
//     ▲   ▲   ▲   ▲
//     │   │   │   └── salesforce Opportunity.Proposal_Drive_File__c
//     │   │   └────── jira Issue.description / driveDesignDocId
//     │   └────────── gmail Email.attachments[].driveFileId
//     └────────────── slack Message.files[].drive_file_id (images)
//   github ◀───────── jira Issue.remoteLinks[] (resolving PR)
//
// A cross-provider integrity phase then pulls every linking provider and
// resolves each reference against the target provider's real records
// (the cross-provider analogue of the simpro shape-integrity phase),
// alongside every generic Nango route (connections, records, metadata,
// sync trigger, inbound + outbound webhooks, connect sessions) plus the
// provider-native `/proxy/*` path for each proxy provider:
//
//   xero        GET /proxy/api.xro/2.0/Invoices         → Xero envelope
//   quickbooks  GET /proxy/v3/company/<realm>/query     → QBO query
//   google-drive GET /proxy/drive/v3/files              → Drive fileList
//   onedrive    GET /proxy/v1.0/me/drive/root/children  → Graph driveItems
//
//   pnpm --filter api-emulators-quickstart nango-providers-sim
import { nangoPlugin, seedFromConfig } from "@emulators/nango";
import { heading, mount } from "./harness.js";

const BASE = "http://localhost:4030";
const DAY = 86_400_000;
const START = Date.now() - 90 * DAY;
const iso = (n: number): string => new Date(START + n * DAY).toISOString();
const date = (n: number): string => iso(n).slice(0, 10);

// Every generic nango route the sim must touch (hubspot-emu OAuth shim is
// provider-specific and out of scope for these four providers).
const ROUTES = [
  "GET /",
  "GET /connect",
  "GET /connection",
  "GET /connections/:connectionId",
  "GET /records",
  "POST /connection",
  "POST /connections/:connectionId/records/:model",
  "PATCH /connection/:connectionId/metadata",
  "PUT /connection/:connectionId/metadata",
  "POST /sync/trigger",
  "GET /webhook-settings",
  "POST /webhook-settings",
  "GET /webhook-deliveries",
  "POST /webhook/:environmentUuid/:providerConfigKey",
  "POST /connect/sessions",
  "POST /connect/sessions/reconnect",
  "POST /connect/complete",
  "ALL /proxy/*",
] as const;

const covered = new Set<string>();
let calls = 0;
let failures = 0;
let app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> };

async function hit(route: string, url: string, init: RequestInit | undefined, okStatuses: number[]): Promise<Response> {
  covered.add(route);
  calls++;
  const res = await app.request(url, init);
  const ok = okStatuses.includes(res.status);
  if (!ok) {
    failures++;
    console.log(`  ✗ ${route}  →  ${res.status}  ${url}`);
  } else {
    console.log(`  ✓ ${route.padEnd(48)} →  ${res.status}`);
  }
  return res;
}

const J = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ── 90 days of dated records, in each provider's native field shape ─────────
function xeroRecords() {
  const Invoice = Array.from({ length: 30 }, (_, i) => ({
    InvoiceID: `xero-inv-${i}`,
    InvoiceNumber: `INV-${1000 + i}`,
    Type: "ACCREC",
    Status: i % 4 === 0 ? "PAID" : "AUTHORISED",
    Total: 500 + i * 25,
    Date: `/Date(${START + i * 3 * DAY})/`,
    Contact: { ContactID: `xero-c-${i % 5}`, Name: `Customer ${i % 5}` },
  }));
  const Contact = Array.from({ length: 5 }, (_, i) => ({
    ContactID: `xero-c-${i}`,
    Name: `Customer ${i}`,
    EmailAddress: `c${i}@agent-emulate.dev`,
  }));
  return { Invoice, Contact };
}
function quickbooksRecords() {
  const Invoice = Array.from({ length: 30 }, (_, i) => ({
    Id: String(i + 1),
    DocNumber: `1${String(i).padStart(3, "0")}`,
    TxnDate: date(i * 3),
    TotalAmt: 750 + i * 30,
    Balance: i % 3 === 0 ? 0 : 750 + i * 30,
    CustomerRef: { value: String((i % 4) + 1), name: `QB Customer ${i % 4}` },
  }));
  const Customer = Array.from({ length: 4 }, (_, i) => ({
    Id: String(i + 1),
    DisplayName: `QB Customer ${i}`,
    PrimaryEmailAddr: { Address: `qb${i}@agent-emulate.dev` },
  }));
  return { Invoice, Customer };
}
// Google Drive is the org's canonical asset store. Even ids are images,
// odd ids are PDFs/docs — other providers (Slack, Gmail, Jira, Salesforce)
// link back to these files by id + webViewLink, so the Drive set is the
// single source of truth the cross-provider integrity phase resolves against.
const driveLink = (id: string): string => `https://drive.google.com/file/d/${id}/view`;
const DRIVE_ID_RE = /\/d\/([^/]+)\//;
function driveRecords() {
  const DriveFile = Array.from({ length: 40 }, (_, i) => {
    const isImage = i % 2 === 0;
    const id = `gdrive-${i}`;
    const d = Math.floor(i * 2.25);
    return {
      id,
      name: isImage ? `site-photo-${date(d)}.png` : `Report-${date(d)}.pdf`,
      mimeType: isImage ? "image/png" : "application/pdf",
      modifiedTime: iso(d),
      size: String(10_000 + i * 512),
      webViewLink: driveLink(id),
      webContentLink: `https://drive.google.com/uc?id=${id}&export=download`,
      thumbnailLink: isImage ? `https://drive.google.com/thumbnail?id=${id}` : undefined,
    };
  });
  return { DriveFile };
}
const driveImageId = (n: number): string => `gdrive-${(n * 2) % 40}`; // even → image
const driveDocId = (n: number): string => `gdrive-${((n * 2) % 40) + 1}`; // odd → doc

// ── Cross-provider records: each links back to real Drive files / GitHub PRs ─
function slackMessages() {
  // Every message that shares an asset embeds the Drive image id + share URL.
  const Message = Array.from({ length: 30 }, (_, i) => {
    const shares = i % 3 === 0;
    const imgId = driveImageId(i);
    return {
      ts: `${(START + i * 3 * DAY) / 1000}`,
      channel: "C-FIELD-OPS",
      user: `U${(i % 4) + 1}`,
      date: iso(i * 3),
      text: shares ? `Site photo for job ${1000 + i} — ${driveLink(imgId)}` : `Status update on job ${1000 + i}`,
      files: shares
        ? [{ id: `F${i}`, name: `site-photo.png`, drive_file_id: imgId, url_private: driveLink(imgId) }]
        : [],
    };
  });
  return { Message };
}
function gmailEmails() {
  const Email = Array.from({ length: 30 }, (_, i) => {
    const hasAttach = i % 2 === 0;
    const docId = driveDocId(i);
    return {
      id: `gmail-${i}`,
      threadId: `thr-${Math.floor(i / 3)}`,
      date: iso(i * 3),
      from: `ops@agent-emulate.dev`,
      to: `customer${i % 5}@agent-emulate.dev`,
      subject: `Report for job ${1000 + i}`,
      snippet: hasAttach ? `Please find the attached report.` : `Quick update on your job.`,
      attachments: hasAttach
        ? [
            {
              filename: `Report-${date(i * 3)}.pdf`,
              mimeType: "application/pdf",
              driveFileId: docId,
              driveLink: driveLink(docId),
            },
          ]
        : [],
    };
  });
  return { Email };
}
function githubPRs() {
  const PullRequest = Array.from({ length: 25 }, (_, i) => ({
    id: 50_000 + i,
    number: 100 + i,
    title: `Fix scheduling defect ${i}`,
    state: i % 4 === 0 ? "closed" : "open",
    html_url: `https://github.com/acme/field-ops/pull/${100 + i}`,
    created_at: iso(i * 3.5),
    merged_at: i % 4 === 0 ? iso(i * 3.5 + 1) : null,
    user: { login: `dev${(i % 3) + 1}` },
  }));
  return { PullRequest };
}
function jiraIssues() {
  // Each issue links a Drive design doc + the GitHub PR that resolves it.
  const Issue = Array.from({ length: 25 }, (_, i) => {
    const docId = driveDocId(i + 1);
    const prNumber = 100 + (i % 25);
    return {
      id: `jira-${i}`,
      key: `FIELD-${200 + i}`,
      created: iso(i * 3.6),
      fields: {
        summary: `Defect on job ${1000 + i}`,
        status: { name: i % 3 === 0 ? "Done" : "In Progress" },
        description: `Design doc: ${driveLink(docId)}`,
      },
      driveDesignDocId: docId,
      remoteLinks: [
        {
          application: "github",
          pull_request_id: 50_000 + (i % 25),
          url: `https://github.com/acme/field-ops/pull/${prNumber}`,
        },
      ],
    };
  });
  return { Issue };
}
function salesforceOpps() {
  // CRM opportunities attach the Drive proposal doc by id + share URL.
  const Opportunity = Array.from({ length: 20 }, (_, i) => {
    const docId = driveDocId(i + 2);
    return {
      Id: `006${String(i).padStart(15, "0")}`,
      Name: `Acme Expansion ${i}`,
      StageName: i % 3 === 0 ? "Closed Won" : "Proposal",
      Amount: 25_000 + i * 1_500,
      CloseDate: date(i * 4),
      CreatedDate: iso(i * 4),
      Proposal_Drive_File__c: docId,
      Proposal_URL__c: driveLink(docId),
    };
  });
  return { Opportunity };
}
function onedriveRecords() {
  const DriveItem = Array.from({ length: 40 }, (_, i) => ({
    id: `od-${i}`,
    name: `Doc-${date(Math.floor(i * 2.25))}.docx`,
    size: 8_000 + i * 400,
    lastModifiedDateTime: iso(Math.floor(i * 2.25)),
    file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  }));
  return { DriveItem };
}

async function main(): Promise<void> {
  const emu = mount(nangoPlugin, BASE);
  app = emu.app;

  seedFromConfig(emu.store, BASE, {
    connections: [
      {
        id: "xero-acme",
        provider: "xero",
        provider_config_key: "xero",
        connection_config: { tenantId: "tenant-acme" },
        metadata: { organizationId: "org_acme" },
        records: xeroRecords(),
      },
      {
        id: "quickbooks-acme",
        provider: "quickbooks",
        provider_config_key: "quickbooks",
        connection_config: { realmId: "9341453644728342" },
        metadata: { organizationId: "org_acme" },
        records: quickbooksRecords(),
      },
      {
        id: "google-drive-acme",
        provider: "google-drive",
        provider_config_key: "google-drive",
        metadata: { organizationId: "org_acme" },
        records: driveRecords(),
      },
      {
        id: "onedrive-acme",
        provider: "onedrive",
        provider_config_key: "onedrive",
        metadata: { organizationId: "org_acme" },
        records: onedriveRecords(),
      },
      // Cross-provider graph — all link back into google-drive-acme / github-acme.
      {
        id: "slack-acme",
        provider: "slack",
        provider_config_key: "slack",
        metadata: { organizationId: "org_acme" },
        records: slackMessages(),
      },
      {
        id: "gmail-acme",
        provider: "gmail",
        provider_config_key: "gmail",
        metadata: { organizationId: "org_acme" },
        records: gmailEmails(),
      },
      {
        id: "github-acme",
        provider: "github",
        provider_config_key: "github",
        metadata: { organizationId: "org_acme" },
        records: githubPRs(),
      },
      {
        id: "jira-acme",
        provider: "jira",
        provider_config_key: "jira",
        metadata: { organizationId: "org_acme" },
        records: jiraIssues(),
      },
      {
        id: "salesforce-acme",
        provider: "salesforce",
        provider_config_key: "salesforce",
        metadata: { organizationId: "org_acme" },
        records: salesforceOpps(),
      },
    ],
  });

  const providers = [
    { id: "xero-acme", key: "xero", models: ["Invoice", "Contact"] },
    { id: "quickbooks-acme", key: "quickbooks", models: ["Invoice", "Customer"] },
    { id: "google-drive-acme", key: "google-drive", models: ["DriveFile"] },
    { id: "onedrive-acme", key: "onedrive", models: ["DriveItem"] },
  ];

  heading("Nango sim — org-wide surface (4 connections, 90 days of records)");

  await hit("GET /", `${BASE}/`, undefined, [200]);
  await hit("GET /connect", `${BASE}/connect`, undefined, [200]);
  await hit("GET /connection", `${BASE}/connection`, undefined, [200]);
  // A backend programmatically registers a new connection (token already held).
  await hit(
    "POST /connection",
    `${BASE}/connection`,
    J({
      connection_id: "xero-sandbox",
      provider_config_key: "xero",
      credentials: { access_token: "tok-sandbox", refresh_token: "ref-sandbox" },
      connection_config: { tenantId: "tenant-sandbox" },
      metadata: { organizationId: "org_acme" },
    }),
    [200, 201],
  );
  await hit("GET /webhook-settings", `${BASE}/webhook-settings`, undefined, [200]);
  await hit(
    "POST /webhook-settings",
    `${BASE}/webhook-settings`,
    J({ url: "https://consumer.example/nango", events: ["sync", "forward"] }),
    [200],
  );

  for (const p of providers) {
    heading(`Nango sim — ${p.key}`);

    await hit(
      "GET /connections/:connectionId",
      `${BASE}/connections/${p.id}`,
      { headers: { "Provider-Config-Key": p.key } },
      [200],
    );

    for (const model of p.models) {
      await hit(
        "GET /records",
        `${BASE}/records?model=${model}`,
        { headers: { "Connection-Id": p.id, "Provider-Config-Key": p.key } },
        [200],
      );
    }

    // A live record lands today (3-month window + 1 fresh tick).
    await hit(
      "POST /connections/:connectionId/records/:model",
      `${BASE}/connections/${p.id}/records/${p.models[0]}`,
      J({ records: [{ id: `live-${p.key}-today`, _liveAt: iso(90) }] }),
      [200],
    );

    // Persist sync cursor (PATCH merge) then overwrite (PUT replace).
    await hit(
      "PATCH /connection/:connectionId/metadata",
      `${BASE}/connection/${p.id}/metadata`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastSyncedAt: iso(90) }),
      },
      [200],
    );
    await hit(
      "PUT /connection/:connectionId/metadata",
      `${BASE}/connection/${p.id}/metadata`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: "org_acme", cursor: "c-90" }),
      },
      [200],
    );

    await hit(
      "POST /sync/trigger",
      `${BASE}/sync/trigger`,
      J({ connection_id: p.id, provider_config_key: p.key, model: p.models[0] }),
      [200],
    );

    // Provider POSTs to its inbound webhook URL → Nango forwards it.
    await hit(
      "POST /webhook/:environmentUuid/:providerConfigKey",
      `${BASE}/webhook/env-1/${p.key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Connection-Id": p.id },
        body: JSON.stringify({ event: "record.updated", model: p.models[0] }),
      },
      [200],
    );
  }

  heading("Nango sim — provider-native /proxy calls");

  const proxy = async (key: string, id: string, path: string) =>
    hit(
      "ALL /proxy/*",
      `${BASE}/proxy/${path}`,
      { headers: { "Connection-Id": id, "Provider-Config-Key": key } },
      [200],
    );

  // Xero pluralises the response key (Invoice → Invoices).
  const xr = (await (await proxy("xero", "xero-acme", "api.xro/2.0/Invoices")).json()) as {
    Invoices?: unknown[];
    Status?: string;
  };
  console.log(`    ↳ Xero envelope: Status=${xr.Status}, Invoices rows=${xr.Invoices?.length ?? 0}`);

  const qq = encodeURIComponent("SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100");
  const qbr = (await (
    await proxy("quickbooks", "quickbooks-acme", `v3/company/9341453644728342/query?query=${qq}`)
  ).json()) as {
    QueryResponse?: { Invoice?: unknown[] };
  };
  console.log(`    ↳ QBO QueryResponse.Invoice rows=${qbr.QueryResponse?.Invoice?.length ?? 0}`);

  const gd = (await (await proxy("google-drive", "google-drive-acme", "drive/v3/files?pageSize=10")).json()) as {
    kind?: string;
    files?: unknown[];
  };
  console.log(`    ↳ Drive ${gd.kind}: ${gd.files?.length ?? 0} files (page)`);

  const od = (await (await proxy("onedrive", "onedrive-acme", "v1.0/me/drive/root/children?$top=10")).json()) as {
    value?: unknown[];
  };
  console.log(`    ↳ Graph driveItems: ${od.value?.length ?? 0} items (page)`);

  heading("Nango sim — connect-session handshake + reconnect");

  const sess = (await (
    await hit(
      "POST /connect/sessions",
      `${BASE}/connect/sessions`,
      J({ end_user: { id: "user_42", tags: { organizationId: "org_acme" } }, allowed_integrations: ["xero"] }),
      [200, 201],
    )
  ).json()) as { data: { token: string } };
  await hit(
    "POST /connect/sessions/reconnect",
    `${BASE}/connect/sessions/reconnect`,
    J({ connection_id: "xero-acme" }),
    [200, 201],
  );
  await hit("POST /connect/complete", `${BASE}/connect/complete`, J({ token: sess.data.token }), [200, 201]);

  await hit("GET /webhook-deliveries", `${BASE}/webhook-deliveries`, undefined, [200]);

  // ── Cross-provider relationships ────────────────────────────────────────
  // Slack / Gmail / Jira / Salesforce records all carry references *into*
  // google-drive-acme (and Jira into github-acme). We pull each linking
  // provider's records, then resolve every reference against the target
  // provider's real records — the cross-provider analogue of the simpro
  // shape-integrity phase.
  heading("Nango sim — cross-provider relationships (Drive links, PR links)");

  const recs = async (id: string, key: string, model: string): Promise<Record<string, unknown>[]> => {
    const r = await hit(
      "GET /records",
      `${BASE}/records?model=${model}`,
      { headers: { "Connection-Id": id, "Provider-Config-Key": key } },
      [200],
    );
    return ((await r.json()) as { records: Record<string, unknown>[] }).records;
  };

  const driveFiles = await recs("google-drive-acme", "google-drive", "DriveFile");
  const driveIds = new Set(driveFiles.map((f) => String(f.id)));
  const driveImageIds = new Set(driveFiles.filter((f) => f.mimeType === "image/png").map((f) => String(f.id)));
  const driveByLink = new Map(driveFiles.map((f) => [String(f.webViewLink), String(f.id)]));
  const prs = await recs("github-acme", "github", "PullRequest");
  const prIds = new Set(prs.map((p) => Number(p.id)));
  const prByUrl = new Map(prs.map((p) => [String(p.html_url), Number(p.id)]));

  const slackMsgs = await recs("slack-acme", "slack", "Message");
  const gmail = await recs("gmail-acme", "gmail", "Email");
  const jira = await recs("jira-acme", "jira", "Issue");
  const opps = await recs("salesforce-acme", "salesforce", "Opportunity");

  const xref: { label: string; total: number; resolved: number; detail: string }[] = [];
  const linkId = (url: unknown): string | null =>
    typeof url === "string" ? (url.match(DRIVE_ID_RE)?.[1] ?? null) : null;
  const tally = (label: string, rows: { ok: boolean }[], detail: (n: number) => string) => {
    const resolved = rows.filter((r) => r.ok).length;
    xref.push({ label, total: rows.length, resolved, detail: detail(resolved) });
  };

  // Slack file shares → real Drive *images* (both the field id and the URL).
  const slackShares = slackMsgs
    .filter((m) => Array.isArray(m.files) && (m.files as unknown[]).length > 0)
    .map((m) => {
      const f = (m.files as { drive_file_id: string; url_private: string }[])[0]!;
      return { ok: driveImageIds.has(f.drive_file_id) && linkId(f.url_private) === f.drive_file_id };
    });
  tally("slack message.files → Drive image", slackShares, (n) => `${n} share(s) → real image`);

  // Gmail attachments → real Drive docs.
  const gmailAttach = gmail
    .filter((e) => Array.isArray(e.attachments) && (e.attachments as unknown[]).length > 0)
    .map((e) => {
      const a = (e.attachments as { driveFileId: string; driveLink: string }[])[0]!;
      return { ok: driveIds.has(a.driveFileId) && linkId(a.driveLink) === a.driveFileId };
    });
  tally("gmail attachment → Drive doc", gmailAttach, (n) => `${n} attachment(s) → real file`);

  // Jira issues → Drive design doc *and* the GitHub PR that resolves them.
  const jiraDrive = jira.map((j) => {
    const inDesc = linkId((j.fields as { description: string }).description);
    return { ok: driveIds.has(String(j.driveDesignDocId)) && inDesc === j.driveDesignDocId };
  });
  tally("jira issue → Drive design doc", jiraDrive, (n) => `${n} issue(s) → real doc`);
  const jiraGithub = jira.map((j) => {
    const rl = (j.remoteLinks as { pull_request_id: number; url: string }[])[0]!;
    return { ok: prIds.has(rl.pull_request_id) && prByUrl.get(rl.url) === rl.pull_request_id };
  });
  tally("jira issue → GitHub PR", jiraGithub, (n) => `${n} issue(s) → real PR`);

  // Salesforce opportunities → Drive proposal doc.
  const sfDrive = opps.map((o) => ({
    ok:
      driveIds.has(String(o.Proposal_Drive_File__c)) &&
      driveByLink.get(String(o.Proposal_URL__c)) === o.Proposal_Drive_File__c,
  }));
  tally("salesforce opp → Drive proposal", sfDrive, (n) => `${n} opp(s) → real doc`);

  let xrefTotal = 0;
  let xrefResolved = 0;
  for (const x of xref) {
    xrefTotal += x.total;
    xrefResolved += x.resolved;
    const good = x.resolved === x.total && x.total > 0;
    console.log(`  ${good ? "✅" : "❌"} ${x.label.padEnd(34)} ${x.resolved}/${x.total}  ${x.detail}`);
  }
  const crossRefsOk = xrefTotal > 0 && xrefResolved === xrefTotal;
  console.log(
    `\n  ${xrefResolved}/${xrefTotal} cross-provider references resolve to real linked records — ${crossRefsOk ? "✅ fully linked" : "❌ dangling refs"}`,
  );

  // Every linking provider must also genuinely span the quarter.
  const spanOf = (rows: Record<string, unknown>[], field: string): number => {
    const ts = rows
      .map((r) => Date.parse(String(r[field] ?? "")))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    return ts.length < 2 ? 0 : Math.round((ts[ts.length - 1]! - ts[0]!) / DAY);
  };
  const spans = [
    ["google-drive", spanOf(driveFiles, "modifiedTime")],
    ["slack", spanOf(slackMsgs, "date")],
    ["gmail", spanOf(gmail, "date")],
    ["github", spanOf(prs, "created_at")],
    ["jira", spanOf(jira, "created")],
    ["salesforce", spanOf(opps, "CreatedDate")],
  ] as const;
  console.log("");
  for (const [name, sp] of spans) console.log(`  ${name.padEnd(14)} spans ${sp} days`);
  const spanOk = spans.every(([, sp]) => sp >= 75);
  console.log(`\n  all linking providers span ≥ a quarter — ${spanOk ? "✅ verified" : "❌ too shallow"}`);

  // ── Per-connection independent verification ─────────────────────────────
  // Cross-links proven; now prove each connection stands on its own. For
  // every connection, independently: it resolves through the emulator, each
  // model returns emulator-served records (carrying _nango_metadata, not raw
  // seed), a fresh live append round-trips back through GET /records, and
  // every dated model genuinely spans a quarter.
  heading("Nango sim — per-connection independent verification (resolves + 90 days + read-after-write)");

  const getJSON = async (
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; rows: Record<string, unknown>[] }> => {
    const r = await app.request(url, headers ? { headers } : undefined);
    const body = (await r.json().catch(() => null)) as { records?: Record<string, unknown>[] } | null;
    return { status: r.status, rows: body?.records ?? [] };
  };

  const CONNS: {
    id: string;
    key: string;
    dated: { model: string; at: (r: Record<string, unknown>) => number }[];
    refs: string[];
  }[] = [
    {
      id: "xero-acme",
      key: "xero",
      dated: [{ model: "Invoice", at: (r) => Number(String(r.Date).match(/\d+/)?.[0] ?? NaN) }],
      refs: ["Contact"],
    },
    {
      id: "quickbooks-acme",
      key: "quickbooks",
      dated: [{ model: "Invoice", at: (r) => Date.parse(String(r.TxnDate)) }],
      refs: ["Customer"],
    },
    {
      id: "google-drive-acme",
      key: "google-drive",
      dated: [{ model: "DriveFile", at: (r) => Date.parse(String(r.modifiedTime)) }],
      refs: [],
    },
    {
      id: "onedrive-acme",
      key: "onedrive",
      dated: [{ model: "DriveItem", at: (r) => Date.parse(String(r.lastModifiedDateTime)) }],
      refs: [],
    },
    { id: "slack-acme", key: "slack", dated: [{ model: "Message", at: (r) => Date.parse(String(r.date)) }], refs: [] },
    { id: "gmail-acme", key: "gmail", dated: [{ model: "Email", at: (r) => Date.parse(String(r.date)) }], refs: [] },
    {
      id: "github-acme",
      key: "github",
      dated: [{ model: "PullRequest", at: (r) => Date.parse(String(r.created_at)) }],
      refs: [],
    },
    { id: "jira-acme", key: "jira", dated: [{ model: "Issue", at: (r) => Date.parse(String(r.created)) }], refs: [] },
    {
      id: "salesforce-acme",
      key: "salesforce",
      dated: [{ model: "Opportunity", at: (r) => Date.parse(String(r.CreatedDate)) }],
      refs: [],
    },
  ];

  let connOk = 0;
  for (const cn of CONNS) {
    const problems: string[] = [];

    // 1. The connection itself resolves through the emulator.
    const conn = await app.request(`${BASE}/connections/${cn.id}`, { headers: { "Provider-Config-Key": cn.key } });
    covered.add("GET /connections/:connectionId");
    if (conn.status !== 200) problems.push(`connection ${conn.status}`);
    await conn.body?.cancel();

    let span = 0;
    for (const { model, at } of cn.dated) {
      const h = { "Connection-Id": cn.id, "Provider-Config-Key": cn.key };

      // 2. Records resolve and are emulator-served (carry _nango_metadata).
      const before = await getJSON(`${BASE}/records?model=${model}`, h);
      covered.add("GET /records");
      if (before.status !== 200 || before.rows.length === 0) problems.push(`${model} empty`);
      else if (!before.rows.every((r) => r._nango_metadata)) problems.push(`${model} not emulator-served`);

      // 3. The dated model genuinely spans a quarter.
      const ts = before.rows
        .map(at)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
      span = ts.length < 2 ? 0 : Math.round((ts[ts.length - 1]! - ts[0]!) / DAY);
      if (span < 75) problems.push(`${model} span ${span}d`);

      // 4. A fresh live append round-trips back through GET /records.
      const liveId = `live-${cn.key}-verify`;
      const ap = await app.request(
        `${BASE}/connections/${cn.id}/records/${model}`,
        J({ records: [{ id: liveId, _liveAt: iso(90) }] }),
      );
      covered.add("POST /connections/:connectionId/records/:model");
      await ap.body?.cancel();
      const after = await getJSON(`${BASE}/records?model=${model}`, h);
      if (ap.status !== 200 || !after.rows.some((r) => r.id === liveId)) problems.push(`${model} read-after-write`);
    }

    // Reference (non-time-series) models must still resolve.
    for (const model of cn.refs) {
      const rec = await getJSON(`${BASE}/records?model=${model}`, {
        "Connection-Id": cn.id,
        "Provider-Config-Key": cn.key,
      });
      if (rec.status !== 200 || rec.rows.length === 0) problems.push(`${model} empty`);
    }

    const good = problems.length === 0;
    if (good) connOk++;
    console.log(
      `  ${good ? "✅" : "❌"} ${cn.key.padEnd(13)} ${cn.id.padEnd(18)} ` +
        `conn 200 • ${cn.dated.map((d) => d.model).join("+")} served + read-after-write • spans ${span}d` +
        (good ? "" : `  ← ${problems.join(", ")}`),
    );
  }
  const connsOk = connOk === CONNS.length;
  console.log(
    `\n  ${connOk}/${CONNS.length} connections independently verified ` +
      `(resolve + emulator-served + read-after-write + ≥75-day span) — ${connsOk ? "✅ all green" : "❌ failures"}`,
  );

  heading("Nango sim — coverage report");

  const missing = ROUTES.filter((r) => !covered.has(r));
  const deliveries = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as { deliveries: unknown[] };
  console.log(`\n  ${calls} calls • ${failures} unexpected failures`);
  console.log(`  webhook deliveries captured: ${deliveries.deliveries.length} (sync + forward across 4 providers)`);
  console.log(`  route coverage: ${covered.size}/${ROUTES.length}`);
  console.log(`  cross-provider refs: ${xrefResolved}/${xrefTotal} resolved • provider spans ≥75d: ${spanOk}`);
  console.log(`  per-connection independent verification: ${connOk}/${CONNS.length}`);
  if (missing.length) console.log(`  ❌ MISSING: ${missing.join(" | ")}`);
  const ok = missing.length === 0 && failures === 0 && crossRefsOk && spanOk && connsOk;
  console.log(
    `\n${ok ? "✅" : "❌"} Nango 3-month simulation ${ok ? "complete — every connection independently verified (90 days + read-after-write), all cross-provider references resolved, full route coverage" : "INCOMPLETE"}.\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
