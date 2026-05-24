import { describe, it, expect } from "vitest";
import { generate, registerGenerator, hasGenerator, generatorProviders } from "../generators.js";

// Generators must emit records shaped like each provider's real API record so
// the same code paths an SDK consumer runs against production also run here.
// Deterministic in `seq` so tests + replays are reproducible.

const NOW = new Date("2026-05-16T09:00:00.000Z");

describe("generate — sync record providers", () => {
  it("gmail: INBOX message with Subject/From headers + numeric internalDate", () => {
    const t = generate("gmail", 7, NOW);
    expect(t.kind).toBe("sync");
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("messages");
    const r = t.record as Record<string, any>;
    expect(typeof r.id).toBe("string");
    expect(r.id).toContain("7");
    expect(r.labelIds).toContain("INBOX");
    expect(String(Number(r.internalDate))).toBe(r.internalDate); // string of epoch ms
    const headers = r.payload.headers as { name: string; value: string }[];
    expect(headers.find((h) => h.name === "Subject")).toBeTruthy();
    expect(headers.find((h) => h.name === "From")).toBeTruthy();
  });

  it("graph-mail: Graph message envelope (from.emailAddress, isRead:false)", () => {
    const t = generate("graph-mail", 1, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("messages");
    const r = t.record as Record<string, any>;
    expect(r.from.emailAddress.address).toMatch(/@/);
    expect(r.isRead).toBe(false);
    expect(r.receivedDateTime).toBe(NOW.toISOString());
  });

  it("teams: chatMessage with body.contentType + from.user.displayName", () => {
    const t = generate("teams", 2, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("messages");
    const r = t.record as Record<string, any>;
    expect(r.messageType).toBe("message");
    expect(r.body.contentType).toBe("html");
    expect(typeof r.from.user.displayName).toBe("string");
  });

  it("drive: drive#file with name + mimeType + modifiedTime", () => {
    const t = generate("drive", 3, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("files");
    const r = t.record as Record<string, any>;
    expect(r.kind).toBe("drive#file");
    expect(typeof r.name).toBe("string");
    expect(typeof r.mimeType).toBe("string");
    expect(r.modifiedTime).toBe(NOW.toISOString());
  });

  it("calendar: confirmed event with start/end dateTime", () => {
    const t = generate("calendar", 4, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("events");
    const r = t.record as Record<string, any>;
    expect(r.status).toBe("confirmed");
    expect(typeof r.start.dateTime).toBe("string");
    expect(new Date(r.end.dateTime).getTime()).toBeGreaterThan(new Date(r.start.dateTime).getTime());
  });
});

describe("generate — forward (whatsapp inbound)", () => {
  it("emits the Meta whatsapp_business_account envelope", () => {
    const t = generate("whatsapp", 5, NOW);
    expect(t.kind).toBe("forward");
    if (t.kind !== "forward") throw new Error("unreachable");
    const p = t.payload as Record<string, any>;
    expect(p.object).toBe("whatsapp_business_account");
    const change = p.entry[0].changes[0];
    expect(change.field).toBe("messages");
    expect(change.value.messaging_product).toBe("whatsapp");
    const msg = change.value.messages[0];
    expect(msg.type).toBe("text");
    expect(typeof msg.text.body).toBe("string");
    expect(typeof msg.from).toBe("string");
  });
});

describe("generate — determinism", () => {
  it("same seq → same id; different seq → different id", () => {
    const a = generate("gmail", 11, NOW);
    const b = generate("gmail", 11, NOW);
    const c = generate("gmail", 12, NOW);
    if (a.kind !== "sync" || b.kind !== "sync" || c.kind !== "sync") throw new Error("unreachable");
    expect((a.record as any).id).toBe((b.record as any).id);
    expect((a.record as any).id).not.toBe((c.record as any).id);
  });

  it("throws on a provider it cannot generate for", () => {
    expect(() => generate("pager", 1, NOW)).toThrow(/provider/i);
  });
});

describe("generate — business providers (Phase 2.1, scenario-declared, no source edit)", () => {
  it("xero: ACCREC invoice with totals + currency", () => {
    const t = generate("xero", 1, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("invoices");
    const r = t.record as Record<string, any>;
    expect(r.Type).toBe("ACCREC");
    expect(r.InvoiceNumber).toMatch(/^INV-/);
    expect(r.CurrencyCode).toBe("AUD");
    expect(r.Total).toBeGreaterThan(r.SubTotal);
  });

  it("jira: issue with key + fields.status/issuetype", () => {
    const t = generate("jira", 2, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("issues");
    const r = t.record as Record<string, any>;
    expect(r.key).toMatch(/^SIM-/);
    expect(typeof r.fields.status.name).toBe("string");
    expect(typeof r.fields.issuetype.name).toBe("string");
  });

  it("salesforce: opportunity with StageName + Amount", () => {
    const t = generate("salesforce", 3, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("opportunities");
    const r = t.record as Record<string, any>;
    expect(r.Id).toMatch(/^006SIM/);
    expect(typeof r.StageName).toBe("string");
    expect(typeof r.Amount).toBe("number");
  });

  it("github: pull_request with number/state/base.ref", () => {
    const t = generate("github", 4, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("pull_requests");
    const r = t.record as Record<string, any>;
    expect(typeof r.number).toBe("number");
    expect(["open", "closed"]).toContain(r.state);
    expect(r.base.ref).toBe("main");
  });

  it("slack: message with channel/user/ts", () => {
    const t = generate("slack", 5, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("messages");
    const r = t.record as Record<string, any>;
    expect(r.type).toBe("message");
    expect(typeof r.channel).toBe("string");
    expect(r.ts).toMatch(/\./);
  });
});

describe("generate — native-write providers (Phase 2.2)", () => {
  it("github-issues: POSTs the repo issues API (fires the emulator's own webhook)", () => {
    const t = generate("github-issues", 0, NOW);
    if (t.kind !== "native") throw new Error("unreachable");
    expect(t.method).toBe("POST");
    expect(t.path).toBe("/repos/acme/app/issues");
    const b = t.body as Record<string, any>;
    expect(typeof b.title).toBe("string");
    expect(Array.isArray(b.labels)).toBe(true);
  });

  it("stripe-payments: POSTs a payment_intent with amount + currency", () => {
    const t = generate("stripe-payments", 2, NOW);
    if (t.kind !== "native") throw new Error("unreachable");
    expect(t.method).toBe("POST");
    expect(t.path).toBe("/v1/payment_intents");
    const b = t.body as Record<string, any>;
    expect(typeof b.amount).toBe("number");
    expect(b.currency).toBe("aud");
  });

  it("native providers are discoverable in the open registry", () => {
    expect(hasGenerator("github-issues")).toBe(true);
    expect(hasGenerator("stripe-payments")).toBe(true);
  });
});

describe("generator registry — open for extension", () => {
  it("lists every built-in provider", () => {
    const names = generatorProviders();
    for (const p of ["gmail", "whatsapp", "xero", "jira", "salesforce", "github", "slack"]) {
      expect(names).toContain(p);
    }
  });

  it("hasGenerator reflects (un)known providers", () => {
    expect(hasGenerator("xero")).toBe(true);
    expect(hasGenerator("myspace")).toBe(false);
  });

  it("registerGenerator teaches the simulator a new provider with no source edit", () => {
    expect(hasGenerator("acme-crm")).toBe(false);
    registerGenerator("acme-crm", (seq) => ({
      kind: "sync",
      model: "deals",
      record: { id: `acme-${seq}`, stage: "won" },
    }));
    expect(hasGenerator("acme-crm")).toBe(true);
    const t = generate("acme-crm", 9, NOW);
    if (t.kind !== "sync") throw new Error("unreachable");
    expect(t.model).toBe("deals");
    expect((t.record as any).id).toBe("acme-9");
  });
});
