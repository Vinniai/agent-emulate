import { describe, it, expect } from "vitest";
import { BASE, createTestApp } from "./helpers.js";
import type { NangoSeedConfig } from "../index.js";

// Pagination spec — the Nango proxy must paginate list endpoints exactly like
// each provider's real API so an SDK that follows cursors works unmodified.
// Real mechanics being locked in:
//   Gmail    maxResults (def 100 / max 500) → nextPageToken (omitted last page)
//   Drive    pageSize  (def 100 / max 1000) → nextPageToken (omitted last page)
//   Calendar maxResults (def 250 / max 2500) → nextPageToken; final → nextSyncToken
//   Graph    $top      (def 100 / max 999)  → @odata.nextLink (absolute URL)

const rows = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, threadId: `t${i + 1}` }));

const SEED: NangoSeedConfig = {
  connections: [
    { id: "gm", provider: "google-mail", provider_config_key: "google-mail", records: { messages: rows("m", 5) } },
    { id: "dr", provider: "google-drive", provider_config_key: "google-drive", records: { files: rows("f", 5) } },
    {
      id: "ca",
      provider: "google-calendar",
      provider_config_key: "google-calendar",
      records: { events: rows("e", 5) },
    },
    { id: "ms", provider: "outlook", provider_config_key: "outlook", records: { messages: rows("x", 5) } },
  ],
};

const hdr = (conn: string, key: string) => ({ headers: { "Connection-Id": conn, "Provider-Config-Key": key } });

describe("Nango proxy pagination — Gmail (users.messages.list)", () => {
  it("walks nextPageToken and omits it on the final page", async () => {
    const { app } = createTestApp({ seed: SEED });
    const url = (qs: string) => `${BASE}/proxy/gmail/v1/users/me/messages?${qs}`;

    const p1 = (await (await app.request(url("maxResults=2"), hdr("gm", "google-mail"))).json()) as {
      messages: { id: string; threadId: string }[];
      resultSizeEstimate: number;
      nextPageToken?: string;
    };
    expect(p1.messages).toEqual([
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: "t2" },
    ]);
    // resultSizeEstimate is the TOTAL estimate, never the page size.
    expect(p1.resultSizeEstimate).toBe(5);
    expect(typeof p1.nextPageToken).toBe("string");

    const p2 = (await (
      await app.request(url(`maxResults=2&pageToken=${p1.nextPageToken}`), hdr("gm", "google-mail"))
    ).json()) as typeof p1;
    expect(p2.messages.map((m) => m.id)).toEqual(["m3", "m4"]);

    const p3 = (await (
      await app.request(url(`maxResults=2&pageToken=${p2.nextPageToken}`), hdr("gm", "google-mail"))
    ).json()) as typeof p1;
    expect(p3.messages.map((m) => m.id)).toEqual(["m5"]);
    expect(p3.nextPageToken).toBeUndefined(); // last page: key absent, not null
  });

  it("returns a single page with no token when the set fits the default", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (
      await app.request(`${BASE}/proxy/gmail/v1/users/me/messages`, hdr("gm", "google-mail"))
    ).json()) as { messages: unknown[]; nextPageToken?: string };
    expect(body.messages).toHaveLength(5);
    expect(body.nextPageToken).toBeUndefined();
  });

  it("a trailing /{id} segment returns the full single message verbatim", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (
      await app.request(`${BASE}/proxy/gmail/v1/users/me/messages/m3`, hdr("gm", "google-mail"))
    ).json()) as { id: string; threadId: string };
    expect(body).toMatchObject({ id: "m3", threadId: "t3" });
  });

  it("non-numeric / zero maxResults falls back to the default page size", async () => {
    const { app } = createTestApp({ seed: SEED });
    for (const bad of ["maxResults=0", "maxResults=-3", "maxResults=abc"]) {
      const body = (await (
        await app.request(`${BASE}/proxy/gmail/v1/users/me/messages?${bad}`, hdr("gm", "google-mail"))
      ).json()) as { messages: unknown[]; nextPageToken?: string };
      expect(body.messages).toHaveLength(5);
      expect(body.nextPageToken).toBeUndefined();
    }
  });
});

describe("Nango proxy pagination — Drive v3 (files.list)", () => {
  it("keeps kind/incompleteSearch and walks pageSize/pageToken", async () => {
    const { app } = createTestApp({ seed: SEED });
    const url = (qs: string) => `${BASE}/proxy/drive/v3/files?${qs}`;

    const p1 = (await (await app.request(url("pageSize=3"), hdr("dr", "google-drive"))).json()) as {
      kind: string;
      incompleteSearch: boolean;
      files: { id: string }[];
      nextPageToken?: string;
    };
    expect(p1.kind).toBe("drive#fileList");
    expect(p1.incompleteSearch).toBe(false);
    expect(p1.files.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(typeof p1.nextPageToken).toBe("string");

    const p2 = (await (
      await app.request(url(`pageSize=3&pageToken=${p1.nextPageToken}`), hdr("dr", "google-drive"))
    ).json()) as typeof p1;
    expect(p2.files.map((f) => f.id)).toEqual(["f4", "f5"]);
    expect(p2.nextPageToken).toBeUndefined();
  });

  it("a trailing /{id} returns the single file", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (await app.request(`${BASE}/proxy/drive/v3/files/f4`, hdr("dr", "google-drive"))).json()) as {
      id: string;
    };
    expect(body.id).toBe("f4");
  });
});

describe("Nango proxy pagination — Calendar v3 (events.list)", () => {
  it("emits the calendar-level wrapper, no incompleteSearch, nextPageToken→nextSyncToken", async () => {
    const { app } = createTestApp({ seed: SEED });
    const url = (qs: string) => `${BASE}/proxy/calendar/v3/calendars/primary/events?${qs}`;

    const p1 = (await (await app.request(url("maxResults=3"), hdr("ca", "google-calendar"))).json()) as Record<
      string,
      unknown
    > & { items: { id: string }[]; nextPageToken?: string; nextSyncToken?: string };

    // Real events.list wrapper fields — and incompleteSearch is Drive-only.
    expect(p1.kind).toBe("calendar#events");
    expect(p1.summary).toBe("primary");
    expect(p1.timeZone).toBe("UTC");
    expect(p1.accessRole).toBe("owner");
    expect(p1.defaultReminders).toEqual([]);
    expect(typeof p1.etag).toBe("string");
    expect(typeof p1.updated).toBe("string");
    expect("incompleteSearch" in p1).toBe(false);

    expect(p1.items.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(typeof p1.nextPageToken).toBe("string");
    expect(p1.nextSyncToken).toBeUndefined(); // not the final page

    const p2 = (await (
      await app.request(url(`maxResults=3&pageToken=${p1.nextPageToken}`), hdr("ca", "google-calendar"))
    ).json()) as typeof p1;
    expect(p2.items.map((e) => e.id)).toEqual(["e4", "e5"]);
    expect(p2.nextPageToken).toBeUndefined(); // final page
    expect(typeof p2.nextSyncToken).toBe("string"); // final page carries the sync token
  });

  it("derives summary from the {calId} path segment", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (
      await app.request(
        `${BASE}/proxy/calendar/v3/calendars/${encodeURIComponent("team@agent-emulate.dev")}/events`,
        hdr("ca", "google-calendar"),
      )
    ).json()) as { summary: string };
    expect(body.summary).toBe("team@agent-emulate.dev");
  });
});

describe("Nango proxy pagination — Microsoft Graph (OData)", () => {
  it("@odata.nextLink is an absolute, followable URL; @odata.count only with $count=true", async () => {
    const { app } = createTestApp({ seed: SEED });
    const url = (qs: string) => `${BASE}/proxy/v1.0/me/messages?${qs}`;

    const p1 = (await (await app.request(url("$top=2&$count=true"), hdr("ms", "outlook"))).json()) as Record<
      string,
      unknown
    > & { value: { id: string }[]; "@odata.nextLink"?: string; "@odata.count"?: number };

    expect(p1["@odata.context"]).toBe("https://graph.microsoft.com/v1.0/$metadata#messages");
    expect(p1["@odata.count"]).toBe(5);
    expect(p1.value.map((m) => m.id)).toEqual(["x1", "x2"]);

    const nextLink = p1["@odata.nextLink"];
    expect(typeof nextLink).toBe("string");
    expect(nextLink!.startsWith(BASE)).toBe(true); // absolute, routes back here
    expect(nextLink).toContain("%24skiptoken="); // $ is URL-encoded

    // Follow it verbatim, exactly as a Graph SDK would.
    const p2 = (await (await app.request(nextLink!, hdr("ms", "outlook"))).json()) as typeof p1;
    expect(p2.value.map((m) => m.id)).toEqual(["x3", "x4"]);

    const p3 = (await (await app.request(p2["@odata.nextLink"]!, hdr("ms", "outlook"))).json()) as typeof p1;
    expect(p3.value.map((m) => m.id)).toEqual(["x5"]);
    expect("@odata.nextLink" in p3).toBe(false); // final page
  });

  it("omits @odata.count unless $count=true", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (await app.request(`${BASE}/proxy/v1.0/me/messages?$top=2`, hdr("ms", "outlook"))).json()) as {
      "@odata.count"?: number;
    };
    expect("@odata.count" in body).toBe(false);
  });

  it("accepts a bare numeric $skip as the cursor", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (
      await app.request(`${BASE}/proxy/v1.0/me/messages?$top=2&$skip=4`, hdr("ms", "outlook"))
    ).json()) as { value: { id: string }[] };
    expect(body.value.map((m) => m.id)).toEqual(["x5"]);
  });

  it("a trailing /{id} returns the single entity, not a collection", async () => {
    const { app } = createTestApp({ seed: SEED });
    const body = (await (await app.request(`${BASE}/proxy/v1.0/me/messages/x2`, hdr("ms", "outlook"))).json()) as {
      id: string;
      value?: unknown;
    };
    expect(body.id).toBe("x2");
    expect(body.value).toBeUndefined();
  });
});

describe("Nango proxy pagination — token semantics", () => {
  it("page tokens are opaque and round-trip to the same page", async () => {
    const { app } = createTestApp({ seed: SEED });
    const url = (qs: string) => `${BASE}/proxy/gmail/v1/users/me/messages?${qs}`;
    const p1 = (await (await app.request(url("maxResults=2"), hdr("gm", "google-mail"))).json()) as {
      nextPageToken: string;
    };
    const a = (await (
      await app.request(url(`maxResults=2&pageToken=${p1.nextPageToken}`), hdr("gm", "google-mail"))
    ).json()) as {
      messages: { id: string }[];
    };
    const b = (await (
      await app.request(url(`maxResults=2&pageToken=${p1.nextPageToken}`), hdr("gm", "google-mail"))
    ).json()) as {
      messages: { id: string }[];
    };
    expect(a.messages).toEqual(b.messages); // deterministic
  });

  it("a garbage pageToken is tolerated as offset 0 (no 500)", async () => {
    const { app } = createTestApp({ seed: SEED });
    const res = await app.request(
      `${BASE}/proxy/gmail/v1/users/me/messages?maxResults=2&pageToken=not-a-real-token`,
      hdr("gm", "google-mail"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { id: string }[] };
    expect(body.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
