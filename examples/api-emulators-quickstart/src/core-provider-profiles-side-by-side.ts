import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const EMULATE_CLI = join(REPO_ROOT, "packages/emulate/dist/index.js");
const NANGO_SEED_LIBRARY = join(REPO_ROOT, "examples/nango-seeds.yaml");
const DAY = 86_400_000;

const PROFILES = [
  { name: "90d", env: "CORE_90D_NANGO_URL", pastDays: 90, futureDays: 183 },
  { name: "180d", env: "CORE_180D_NANGO_URL", pastDays: 180, futureDays: 183 },
  { name: "1y-plus-6m", env: "CORE_1Y_PLUS_6M_NANGO_URL", pastDays: 365, futureDays: 183 },
] as const;

type Category =
  | "crm"
  | "accounting"
  | "chat"
  | "email"
  | "storage"
  | "calendar"
  | "projects"
  | "code"
  | "support"
  | "hr"
  | "commerce"
  | "analytics"
  | "forms"
  | "database"
  | "scheduling";

type ConnectionSpec = {
  category: Category;
  id: string;
  provider: string;
  key: string;
  model: string;
  source?: "library" | "manual";
};

const CONNECTIONS: readonly ConnectionSpec[] = [
  { category: "crm", id: "salesforce-acme", provider: "salesforce", key: "salesforce", model: "Opportunity" },
  { category: "crm", id: "hubspot-acme", provider: "hubspot", key: "hubspot", model: "Deal", source: "manual" },
  { category: "crm", id: "pipedrive-acme", provider: "pipedrive", key: "pipedrive", model: "Deal" },
  { category: "crm", id: "zoho-crm-acme", provider: "zoho-crm", key: "zoho-crm", model: "Leads" },
  { category: "accounting", id: "freshbooks-acme", provider: "freshbooks", key: "freshbooks", model: "Invoice" },
  { category: "accounting", id: "wave-acme", provider: "wave-accounting", key: "wave-accounting", model: "Invoice" },
  { category: "chat", id: "slack-acme", provider: "slack", key: "slack", model: "Message", source: "manual" },
  { category: "chat", id: "discord-acme", provider: "discord", key: "discord", model: "Message" },
  {
    category: "chat",
    id: "microsoft-teams-acme",
    provider: "microsoft-teams",
    key: "microsoft-teams",
    model: "Channel",
  },
  { category: "email", id: "gmail-acme", provider: "gmail", key: "gmail", model: "Message" },
  {
    category: "email",
    id: "outlook-mail-acme",
    provider: "outlook",
    key: "outlook",
    model: "Message",
    source: "manual",
  },
  { category: "email", id: "mailchimp-acme", provider: "mailchimp", key: "mailchimp", model: "Member" },
  { category: "email", id: "sendgrid-acme", provider: "sendgrid", key: "sendgrid", model: "Contact" },
  { category: "email", id: "klaviyo-acme", provider: "klaviyo", key: "klaviyo", model: "Profile" },
  {
    category: "storage",
    id: "google-drive-acme",
    provider: "google-drive",
    key: "google-drive",
    model: "DriveFile",
    source: "manual",
  },
  {
    category: "storage",
    id: "onedrive-acme",
    provider: "onedrive",
    key: "onedrive",
    model: "DriveItem",
    source: "manual",
  },
  { category: "storage", id: "dropbox-acme", provider: "dropbox", key: "dropbox", model: "File" },
  { category: "storage", id: "box-acme", provider: "box", key: "box", model: "File" },
  {
    category: "calendar",
    id: "google-calendar-acme",
    provider: "google-calendar",
    key: "google-calendar",
    model: "Event",
  },
  {
    category: "calendar",
    id: "outlook-calendar-acme",
    provider: "outlook-calendar",
    key: "outlook-calendar",
    model: "Event",
  },
  { category: "projects", id: "jira-acme", provider: "jira", key: "jira", model: "Issue" },
  { category: "projects", id: "linear-acme", provider: "linear", key: "linear", model: "Issue" },
  { category: "projects", id: "asana-acme", provider: "asana", key: "asana", model: "Task" },
  { category: "projects", id: "notion-acme", provider: "notion", key: "notion", model: "Page" },
  { category: "projects", id: "clickup-acme", provider: "clickup", key: "clickup", model: "Task" },
  { category: "projects", id: "monday-acme", provider: "monday", key: "monday", model: "Item" },
  { category: "projects", id: "trello-acme", provider: "trello", key: "trello", model: "Card" },
  { category: "code", id: "github-acme", provider: "github", key: "github", model: "PullRequest" },
  { category: "code", id: "gitlab-acme", provider: "gitlab", key: "gitlab", model: "MergeRequest" },
  { category: "support", id: "zendesk-acme", provider: "zendesk", key: "zendesk", model: "Ticket" },
  { category: "support", id: "intercom-acme", provider: "intercom", key: "intercom", model: "Conversation" },
  { category: "hr", id: "bamboohr-acme", provider: "bamboohr", key: "bamboohr", model: "Employee" },
  { category: "hr", id: "greenhouse-acme", provider: "greenhouse", key: "greenhouse", model: "Candidate" },
  { category: "hr", id: "lever-acme", provider: "lever", key: "lever", model: "Opportunity" },
  { category: "commerce", id: "shopify-acme", provider: "shopify", key: "shopify", model: "Order" },
  { category: "analytics", id: "mixpanel-acme", provider: "mixpanel", key: "mixpanel", model: "Event" },
  { category: "forms", id: "typeform-acme", provider: "typeform", key: "typeform", model: "Form" },
  { category: "database", id: "airtable-acme", provider: "airtable", key: "airtable", model: "Record" },
  { category: "scheduling", id: "calendly-acme", provider: "calendly", key: "calendly", model: "EventType" },
] as const;

type SeedConnection = {
  id: string;
  provider: string;
  provider_config_key: string;
  connection_config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  records?: Record<string, Record<string, unknown>[]>;
};

type NangoSeedLibrary = { nango?: { connections?: SeedConnection[] } };

const seedLibrary = parseYaml(readFileSync(NANGO_SEED_LIBRARY, "utf8")) as NangoSeedLibrary;
const libraryConnections = new Map((seedLibrary.nango?.connections ?? []).map((conn) => [conn.id, conn]));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seconds = Number(arg("--seconds") ?? process.env.CORE_PROFILES_SECONDS ?? "0") || 0;
const basePort = Number(arg("--base-port") ?? process.env.CORE_PROFILES_BASE_PORT ?? "4040") || 4040;
const workdir = resolve(arg("--workdir") ?? join(tmpdir(), `emulate-core-profiles-${process.pid}`));

function iso(date: Date): string {
  return date.toISOString();
}

function dateOnly(date: Date): string {
  return iso(date).slice(0, 10);
}

function recordDate(base: Date, offsetDays: number): Date {
  return new Date(base.getTime() + offsetDays * DAY);
}

function recordCount(pastDays: number, futureDays: number): number {
  return Math.floor((pastDays + futureDays) / 7) + 1;
}

function isDateKey(key: string): boolean {
  if (/timezone/i.test(key)) return false;
  return /date|time|timestamp|created|modified|updated|due|close|sent|signup/i.test(key);
}

function replacementId(original: unknown, conn: ConnectionSpec, index: number): unknown {
  if (typeof original === "number") return 100_000 + index;
  if (typeof original !== "string") return `${conn.id}-${index.toString().padStart(4, "0")}`;
  if (/^\d+$/.test(original))
    return `${original.slice(0, Math.max(0, original.length - 4))}${index.toString().padStart(4, "0")}`;
  if (/^[A-Za-z0-9_-]+$/.test(original))
    return `${original.replace(/[A-Za-z0-9_-]{3,}$/, "")}${index.toString(36).padStart(6, "0")}`;
  return `${conn.id}-${index.toString().padStart(4, "0")}`;
}

function replacementDate(original: unknown, date: Date): unknown {
  if (typeof original === "number") return Math.floor(date.getTime() / 1000);
  if (typeof original !== "string") return iso(date);
  if (/^\d{13}$/.test(original)) return String(date.getTime());
  if (/^\d{10}$/.test(original)) return String(Math.floor(date.getTime() / 1000));
  if (/^\d{4}-\d{2}-\d{2}$/.test(original)) return dateOnly(date);
  if (/^[A-Z][a-z]{2},/.test(original)) return date.toUTCString();
  if (original.includes("+00:00")) return iso(date).replace(".000Z", "+00:00");
  if (original.includes("+0000")) return iso(date).replace(/[-:]/g, "").replace(".000Z", "+0000");
  return iso(date);
}

function expandTemplate(value: unknown, conn: ConnectionSpec, index: number, date: Date, key = ""): unknown {
  if (Array.isArray(value))
    return value.map((item, itemIndex) => expandTemplate(item, conn, index + itemIndex, date, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        expandTemplate(childValue, conn, index, date, childKey),
      ]),
    );
  }
  if (/^(id|Id|ID)$/.test(key)) return replacementId(value, conn, index);
  if (isDateKey(key)) return replacementDate(value, date);
  return value;
}

function libraryRecordsFor(
  conn: ConnectionSpec,
  profile: (typeof PROFILES)[number],
): Record<string, unknown>[] | undefined {
  const base = libraryConnections.get(conn.id);
  const templateRows = base?.records?.[conn.model];
  if (!templateRows?.length) return undefined;
  const start = new Date(Date.now() - profile.pastDays * DAY);
  const count = recordCount(profile.pastDays, profile.futureDays);
  return Array.from(
    { length: count },
    (_, i) =>
      expandTemplate(templateRows[i % templateRows.length], conn, i, recordDate(start, i * 7)) as Record<
        string,
        unknown
      >,
  );
}

function manualRecordsFor(kind: ConnectionSpec, profile: (typeof PROFILES)[number]): Record<string, unknown>[] {
  const start = new Date(Date.now() - profile.pastDays * DAY);
  const count = recordCount(profile.pastDays, profile.futureDays);
  return Array.from({ length: count }, (_, i) => {
    const d = recordDate(start, i * 7);
    const id = `${kind.id}-${i}`;
    if (kind.id === "outlook-mail-acme") {
      return {
        id,
        createdDateTime: iso(d),
        lastModifiedDateTime: iso(d),
        receivedDateTime: iso(d),
        sentDateTime: iso(d),
        hasAttachments: i % 3 === 0,
        subject: `${dateOnly(d)} service update ${i}`,
        bodyPreview: `Workflow update ${i} for ${profile.name}`,
        importance: i % 5 === 0 ? "high" : "normal",
        from: { emailAddress: { name: `Ops ${i % 4}`, address: `ops${i % 4}@agent-emulate.dev` } },
        toRecipients: [{ emailAddress: { name: "Field Team", address: "field@agent-emulate.dev" } }],
        webLink: `https://outlook.office.com/mail/${id}`,
      };
    }
    if (kind.id === "slack-acme") {
      return {
        type: "message",
        channel: "C-FIELD-OPS",
        user: `U${(1000 + (i % 6)).toString()}`,
        text: `${dateOnly(d)} field workflow message ${i}`,
        ts: `${Math.floor(d.getTime() / 1000)}.${String(i).padStart(6, "0")}`,
        team: "TACME",
        files: i % 4 === 0 ? [{ id: `F${i}`, name: `photo-${i}.png`, mimetype: "image/png" }] : [],
      };
    }
    if (kind.id === "google-drive-acme") {
      return {
        id,
        name: i % 2 === 0 ? `site-photo-${dateOnly(d)}.png` : `quote-${dateOnly(d)}.pdf`,
        mimeType: i % 2 === 0 ? "image/png" : "application/pdf",
        size: 10_000 + i * 512,
        createdTime: iso(d),
        modifiedTime: iso(d),
        webViewLink: `https://files.example.test/${kind.id}/${id}`,
        parents: ["root"],
        trashed: false,
      };
    }
    if (kind.id === "onedrive-acme") {
      return {
        id,
        name: i % 2 === 0 ? `site-photo-${dateOnly(d)}.png` : `quote-${dateOnly(d)}.pdf`,
        size: 10_000 + i * 512,
        createdDateTime: iso(d),
        lastModifiedDateTime: iso(d),
        webUrl: `https://onedrive.example.test/${id}`,
        file: { mimeType: i % 2 === 0 ? "image/png" : "application/pdf" },
        parentReference: { driveId: "drive-acme", id: "root" },
      };
    }
    if (kind.id === "hubspot-acme") {
      return {
        id,
        properties: {
          dealname: `Opportunity ${i}`,
          dealstage: i % 5 === 0 ? "closedwon" : i % 3 === 0 ? "negotiation" : "presentationscheduled",
          amount: String(10_000 + i * 1500),
          closedate: dateOnly(recordDate(d, 30)),
          createdate: iso(d),
          hs_lastmodifieddate: iso(d),
        },
        createdAt: iso(d),
        updatedAt: iso(d),
        archived: false,
      };
    }
    return {
      id,
      name: `Record ${i}`,
      created_at: iso(d),
      updated_at: iso(d),
    };
  });
}

function recordsFor(conn: ConnectionSpec, profile: (typeof PROFILES)[number]): Record<string, unknown>[] {
  const libraryRows = conn.source !== "manual" ? libraryRecordsFor(conn, profile) : undefined;
  return libraryRows ?? manualRecordsFor(conn, profile);
}

function connectionConfigFor(conn: ConnectionSpec): Record<string, unknown> | undefined {
  const base = libraryConnections.get(conn.id);
  if (base?.connection_config) return base.connection_config;
  if (conn.id === "hubspot-acme") return { portal_id: 1234567 };
  if (conn.id === "outlook-mail-acme") return { tenant_id: "1f4e0a8e-d100-4c93-a8b6-acme00000000" };
  if (conn.id === "google-drive-acme") return { root_folder_id: "root" };
  if (conn.id === "onedrive-acme") return { drive_id: "drive-acme" };
  if (conn.id === "slack-acme") return { team_id: "TACME" };
  return undefined;
}

function seedFor(profile: (typeof PROFILES)[number]): Record<string, unknown> {
  return {
    nango: {
      connections: CONNECTIONS.map((conn) => ({
        id: conn.id,
        provider: conn.provider,
        provider_config_key: conn.key,
        connection_config: connectionConfigFor(conn),
        metadata: { category: conn.category, profile: profile.name, model: conn.model, organizationId: "org_acme" },
        records: { [conn.model]: recordsFor(conn, profile) },
      })),
    },
  };
}

function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const check = async (): Promise<void> => {
      try {
        const res = await fetch(`${baseUrl}/connection`);
        if (res.status < 500) {
          await res.body?.cancel();
          resolvePromise();
          return;
        }
        await res.body?.cancel();
      } catch {
        // keep waiting
      }
      if (Date.now() - started > timeoutMs) reject(new Error(`${baseUrl} did not become ready`));
      else setTimeout(() => void check(), 250);
    };
    void check();
  });
}

async function countRecords(baseUrl: string, conn: ConnectionSpec): Promise<number> {
  const res = await fetch(`${baseUrl}/records?model=${encodeURIComponent(conn.model)}`, {
    headers: { "Connection-Id": conn.id, "Provider-Config-Key": conn.key },
  });
  if (!res.ok) throw new Error(`${baseUrl} ${conn.id}/${conn.model} returned ${res.status}`);
  const body = (await res.json()) as { records?: unknown[] };
  return body.records?.length ?? 0;
}

async function main(): Promise<void> {
  if (!existsSync(EMULATE_CLI)) throw new Error(`Build not found at ${EMULATE_CLI}. Run pnpm --filter emulate build.`);
  mkdirSync(workdir, { recursive: true });
  const servers: ChildProcess[] = [];
  let stopping = false;

  const shutdown = (code = 0): void => {
    if (stopping) return;
    stopping = true;
    console.log("\n[core-profiles] shutting down");
    for (const server of servers) {
      if (!server.killed) server.kill("SIGTERM");
    }
    rmSync(workdir, { recursive: true, force: true });
    process.exit(code);
  };
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));

  try {
    console.log(`[core-profiles] writing seeds in ${workdir}`);
    for (let i = 0; i < PROFILES.length; i++) {
      const profile = PROFILES[i]!;
      const port = basePort + i;
      const seedPath = join(workdir, `core-${profile.name}.seed.json`);
      writeFileSync(seedPath, JSON.stringify(seedFor(profile), null, 2));
      const server = spawn(
        process.execPath,
        [
          EMULATE_CLI,
          "start",
          "--service",
          "nango",
          "--port",
          String(port),
          "--base-url",
          `http://localhost:${port}`,
          "--seed",
          seedPath,
        ],
        {
          cwd: workdir,
          env: { ...process.env },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      server.stderr?.on("data", (data: Buffer) => process.stderr.write(`  [${profile.name}] ${data}`));
      servers.push(server);
      await waitForReady(`http://localhost:${port}`, 20_000);
    }

    console.log("\nPaste into your app environment:");
    PROFILES.forEach((profile, i) => console.log(`${profile.env}=http://localhost:${basePort + i}`));

    console.log("\nConnection IDs by category:");
    for (const category of [...new Set(CONNECTIONS.map((conn) => conn.category))]) {
      const ids = CONNECTIONS.filter((conn) => conn.category === category).map((conn) => conn.id);
      console.log(`${category.padEnd(10)} ${ids.join(", ")}`);
    }

    console.log("\nEndpoint smoke checks:");
    for (let i = 0; i < PROFILES.length; i++) {
      const profile = PROFILES[i]!;
      const baseUrl = `http://localhost:${basePort + i}`;
      const counts = await Promise.all(CONNECTIONS.map((conn) => countRecords(baseUrl, conn)));
      const byCategory = new Map<string, number>();
      CONNECTIONS.forEach((conn, index) => {
        byCategory.set(conn.category, (byCategory.get(conn.category) ?? 0) + counts[index]!);
      });
      const expected = recordCount(profile.pastDays, profile.futureDays);
      const providerCountsMatch = counts.every((count) => count === expected);
      const summary = [...byCategory.entries()].map(([category, count]) => `${category}=${count}`).join(" ");
      console.log(
        `${profile.name.padEnd(12)} providers=${CONNECTIONS.length} each=${expected} matched=${providerCountsMatch} ${summary} total=${counts.reduce((a, b) => a + b, 0)}`,
      );
    }

    console.log(
      seconds > 0
        ? `\n[core-profiles] keeping endpoints alive for ${seconds}s`
        : "\n[core-profiles] endpoints are running. Press Ctrl-C to stop.",
    );
    if (seconds > 0) {
      setTimeout(() => shutdown(0), seconds * 1000);
    } else {
      await new Promise<void>(() => {});
    }
  } catch (err) {
    console.error("\n[core-profiles] failed");
    console.error(err);
    shutdown(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
