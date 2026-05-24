// Each generator emits a record/payload shaped like the provider's *real* API
// object, so the consumer's production code paths exercise unchanged. Output is
// deterministic in `seq` for reproducible runs and assertions.
//
// Generators live in an open *registry* keyed by provider name. The six
// inbox/messaging providers ship built in; any Nango-seeded provider (Xero
// invoices, Jira issues, Salesforce opportunities, GitHub PRs, Slack messages)
// is just another entry, so a new stream is declared purely in a scenario YAML
// with zero simulator source edits. Third parties can `registerGenerator(...)`
// their own.

export type GeneratedTick =
  | { kind: "sync"; model: string; record: Record<string, unknown> }
  | { kind: "forward"; payload: Record<string, unknown> }
  // A *native* tick is a direct write against a native emulator's real API.
  // The emulator's own on-write webhook dispatch fires as a side effect — so a
  // native stream drives a realistic provider event stream with no Nango in
  // the path. `path` is provider-relative; the stream's `pathPrefix` (e.g.
  // `/github`) is prepended by the engine for `apps/server`-style mounts.
  //
  // `headers` are merged onto the request alongside the engine's `Authorization`
  // (the generator's values win on conflict). This lets a tick carry the
  // per-request headers a provider read demands — e.g. Nango's `/proxy/*`
  // unified reads need `Connection-Id` + `Provider-Config-Key`.
  | { kind: "native"; method: string; path: string; body?: unknown; headers?: Record<string, string> };

export type GeneratorFn = (seq: number, now: Date) => GeneratedTick;

const SUBJECTS = [
  "AS1851 inspection due",
  "Pump test results",
  "Re: site access",
  "Quarterly compliance report",
  "Defect raised on Level 3",
  "Schedule confirmation",
];
const SENDERS = [
  "ops@agent-emulate.dev",
  "scheduler@agent-emulate.dev",
  "field@agent-emulate.dev",
  "compliance@agent-emulate.dev",
];
const BODIES = [
  "Heads up — the inspection window moved to next Tuesday.",
  "Results attached. One minor defect, see notes.",
  "Confirming the team will be on site at 8am.",
  "Please review and sign off when you get a chance.",
];

const pick = <T>(arr: readonly T[], seq: number): T => arr[seq % arr.length];

function gmail(seq: number, now: Date): GeneratedTick {
  const subject = pick(SUBJECTS, seq);
  const from = pick(SENDERS, seq);
  return {
    kind: "sync",
    model: "messages",
    record: {
      id: `sim-gm-${seq}`,
      threadId: `sim-th-${seq}`,
      labelIds: ["INBOX", "UNREAD"],
      snippet: pick(BODIES, seq),
      internalDate: String(now.getTime()),
      payload: {
        headers: [
          { name: "Subject", value: subject },
          { name: "From", value: from },
          { name: "Date", value: now.toUTCString() },
        ],
      },
    },
  };
}

function graphMail(seq: number, now: Date): GeneratedTick {
  const from = pick(SENDERS, seq);
  return {
    kind: "sync",
    model: "messages",
    record: {
      id: `sim-gmail-${seq}`,
      subject: pick(SUBJECTS, seq),
      bodyPreview: pick(BODIES, seq),
      isRead: false,
      receivedDateTime: now.toISOString(),
      from: { emailAddress: { address: from, name: from.split("@")[0] } },
    },
  };
}

function teams(seq: number, now: Date): GeneratedTick {
  return {
    kind: "sync",
    model: "messages",
    record: {
      id: `sim-tm-${seq}`,
      messageType: "message",
      createdDateTime: now.toISOString(),
      from: { user: { id: `u-${seq % 4}`, displayName: pick(["Sam Ops", "Jess Field", "Priya Lead"], seq) } },
      body: { contentType: "html", content: `<p>${pick(BODIES, seq)}</p>` },
    },
  };
}

function drive(seq: number, now: Date): GeneratedTick {
  const exts = [
    ["report.pdf", "application/pdf"],
    ["photos.zip", "application/zip"],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ] as const;
  const [name, mimeType] = pick(exts, seq);
  return {
    kind: "sync",
    model: "files",
    record: {
      kind: "drive#file",
      id: `sim-dr-${seq}`,
      name: `${seq}-${name}`,
      mimeType,
      modifiedTime: now.toISOString(),
      createdTime: now.toISOString(),
    },
  };
}

function calendar(seq: number, now: Date): GeneratedTick {
  const start = new Date(now.getTime() + 3600_000);
  const end = new Date(start.getTime() + 1800_000);
  return {
    kind: "sync",
    model: "events",
    record: {
      id: `sim-ev-${seq}`,
      status: "confirmed",
      summary: pick(SUBJECTS, seq),
      start: { dateTime: start.toISOString(), timeZone: "UTC" },
      end: { dateTime: end.toISOString(), timeZone: "UTC" },
      created: now.toISOString(),
    },
  };
}

function whatsapp(seq: number, now: Date): GeneratedTick {
  const from = `6140000${String(1000 + (seq % 9000))}`;
  return {
    kind: "forward",
    payload: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_SIM",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "61400000000", phone_number_id: "PNID_SIM" },
                contacts: [{ profile: { name: pick(["Sam", "Jess", "Priya"], seq) }, wa_id: from }],
                messages: [
                  {
                    from,
                    id: `wamid.sim-${seq}`,
                    timestamp: String(Math.floor(now.getTime() / 1000)),
                    type: "text",
                    text: { body: pick(BODIES, seq) },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

// --- High-value business providers (Nango-seeded) --------------------------

const CONTACTS = ["Acme Pty Ltd", "Globex Corp", "Initech", "Umbrella Co", "Soylent Industries"];
const AMOUNTS = [125000, 48050, 990000, 7600, 312400]; // cents

function xero(seq: number, now: Date): GeneratedTick {
  const total = AMOUNTS[seq % AMOUNTS.length] / 100;
  return {
    kind: "sync",
    model: "invoices",
    record: {
      InvoiceID: `sim-inv-${seq}`,
      Type: "ACCREC",
      InvoiceNumber: `INV-${1000 + seq}`,
      Contact: { Name: pick(CONTACTS, seq) },
      Date: now.toISOString().slice(0, 10),
      DueDate: new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10),
      Status: seq % 3 === 0 ? "PAID" : "AUTHORISED",
      SubTotal: total,
      TotalTax: Number((total * 0.1).toFixed(2)),
      Total: Number((total * 1.1).toFixed(2)),
      AmountDue: seq % 3 === 0 ? 0 : Number((total * 1.1).toFixed(2)),
      CurrencyCode: "AUD",
      UpdatedDateUTC: now.toISOString(),
    },
  };
}

function jira(seq: number, now: Date): GeneratedTick {
  const types = ["Bug", "Task", "Story"];
  const statuses = ["To Do", "In Progress", "Done"];
  return {
    kind: "sync",
    model: "issues",
    record: {
      id: `${10000 + seq}`,
      key: `SIM-${seq}`,
      fields: {
        summary: pick(SUBJECTS, seq),
        issuetype: { name: types[seq % types.length] },
        status: { name: statuses[seq % statuses.length] },
        priority: { name: seq % 4 === 0 ? "High" : "Medium" },
        assignee: { displayName: pick(["Sam Ops", "Jess Field", "Priya Lead"], seq) },
        created: now.toISOString(),
        updated: now.toISOString(),
      },
    },
  };
}

function salesforce(seq: number, now: Date): GeneratedTick {
  const stages = ["Prospecting", "Qualification", "Proposal", "Closed Won", "Closed Lost"];
  return {
    kind: "sync",
    model: "opportunities",
    record: {
      Id: `006SIM${String(seq).padStart(9, "0")}`,
      Name: `${pick(CONTACTS, seq)} — Expansion`,
      StageName: stages[seq % stages.length],
      Amount: AMOUNTS[seq % AMOUNTS.length] / 100,
      Probability: (seq % 5) * 20,
      CloseDate: new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
      CreatedDate: now.toISOString(),
      LastModifiedDate: now.toISOString(),
    },
  };
}

function github(seq: number, now: Date): GeneratedTick {
  const states = ["open", "open", "closed"];
  return {
    kind: "sync",
    model: "pull_requests",
    record: {
      id: 5_000_000 + seq,
      number: seq + 1,
      state: states[seq % states.length],
      title: pick(SUBJECTS, seq),
      user: { login: pick(["octocat", "hubot", "monalisa"], seq) },
      draft: seq % 5 === 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      merged: seq % 3 === 2,
      head: { ref: `feature/sim-${seq}` },
      base: { ref: "main" },
    },
  };
}

function slack(seq: number, now: Date): GeneratedTick {
  const ts = (now.getTime() / 1000).toFixed(6);
  return {
    kind: "sync",
    model: "messages",
    record: {
      type: "message",
      channel: pick(["C_OPS", "C_FIELD", "C_COMPLIANCE"], seq),
      user: pick(["U_SAM", "U_JESS", "U_PRIYA"], seq),
      text: pick(BODIES, seq),
      ts,
      client_msg_id: `sim-slack-${seq}`,
    },
  };
}

// --- Native-write providers ------------------------------------------------
//
// These don't append a Nango record — they POST a native emulator's real API,
// and the emulator's *own* webhook dispatch (now retry-backed) fires the
// event. The path is provider-relative; demo identifiers are fixed so the
// scenario only has to seed `acme/app` (GitHub) and a Stripe webhook endpoint.

const PR_TITLES = [
  "Fix flaky pump-test parser",
  "Add AS1851 schedule export",
  "Bump compliance ruleset to 2026",
  "Patch defect-notification race",
];

function githubIssues(seq: number, now: Date): GeneratedTick {
  return {
    kind: "native",
    method: "POST",
    path: "/repos/acme/app/issues",
    body: {
      title: `${pick(PR_TITLES, seq)} (#${seq})`,
      body: `${pick(BODIES, seq)}\n\nopened by emulate-sim at ${now.toISOString()}`,
      labels: [seq % 2 === 0 ? "bug" : "enhancement"],
    },
  };
}

function stripePayments(seq: number, now: Date): GeneratedTick {
  return {
    kind: "native",
    method: "POST",
    path: "/v1/payment_intents",
    body: {
      amount: AMOUNTS[seq % AMOUNTS.length],
      currency: "aud",
      description: `Invoice ${1000 + seq} — ${pick(CONTACTS, seq)}`,
      metadata: { simSeq: String(seq), at: now.toISOString() },
    },
  };
}

// --- Registry --------------------------------------------------------------

const GENERATORS = new Map<string, GeneratorFn>([
  ["gmail", gmail],
  ["graph-mail", graphMail],
  ["teams", teams],
  ["drive", drive],
  ["calendar", calendar],
  ["whatsapp", whatsapp],
  ["xero", xero],
  ["jira", jira],
  ["salesforce", salesforce],
  ["github", github],
  ["slack", slack],
  ["github-issues", githubIssues],
  ["stripe-payments", stripePayments],
]);

/** Register (or override) a generator for `provider`. Lets a host app teach
 *  the simulator about providers it seeds without forking this package. */
export function registerGenerator(provider: string, fn: GeneratorFn): void {
  GENERATORS.set(provider, fn);
}

/** True if a scenario stream may name this provider. */
export function hasGenerator(provider: string): boolean {
  return GENERATORS.has(provider);
}

/** All registered provider names (sorted, for help text / validation errors). */
export function generatorProviders(): string[] {
  return [...GENERATORS.keys()].sort();
}

/** Build one provider-faithful tick. Deterministic in `seq`. */
export function generate(provider: string, seq: number, now: Date): GeneratedTick {
  const fn = GENERATORS.get(provider);
  if (!fn) {
    throw new Error(`[emulate-sim] no generator for provider "${provider}" (have: ${generatorProviders().join(", ")})`);
  }
  return fn(seq, now);
}
