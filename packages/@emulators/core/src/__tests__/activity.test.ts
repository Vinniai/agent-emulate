import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { activityBus, registerActivityRoutes, renderActivityCard, type ActivityEvent } from "../activity.js";

function evt(over: Partial<ActivityEvent> = {}): ActivityEvent {
  return { ts: Date.now(), service: "google", entity: "/users/me", action: "GET", id: "200", ...over };
}

// The bus is a process-wide singleton (pinned to globalThis). Each test seeds
// its own events; recent(limit) windows the ring so prior events don't leak in.
describe("activityBus", () => {
  it("returns most-recent-first and filters by service", () => {
    activityBus.publish(evt({ service: "google", id: "g1" }));
    activityBus.publish(evt({ service: "stripe", id: "s1" }));
    activityBus.publish(evt({ service: "google", id: "g2" }));

    const recent = activityBus.recent(3);
    expect(recent.map((e) => e.id)).toEqual(["g2", "s1", "g1"]);

    const google = activityBus.recent(10, "google");
    expect(google.every((e) => e.service === "google")).toBe(true);
    expect(google.map((e) => e.id)).toContain("g2");
    expect(google.map((e) => e.id)).not.toContain("s1");
  });

  it("notifies subscribers and unsubscribes cleanly", () => {
    const seen: string[] = [];
    const unsub = activityBus.subscribe((e) => seen.push(e.id));
    activityBus.publish(evt({ id: "sub1" }));
    unsub();
    activityBus.publish(evt({ id: "sub2" }));
    expect(seen).toContain("sub1");
    expect(seen).not.toContain("sub2");
  });
});

describe("registerActivityRoutes", () => {
  let app: Hono;
  beforeEach(() => {
    app = new Hono();
    registerActivityRoutes(app);
  });

  it("serves recent events as JSON, honoring ?service= and ?limit=", async () => {
    activityBus.publish(evt({ service: "github", id: "gh1", entity: "/repos" }));
    activityBus.publish(evt({ service: "stripe", id: "st1", entity: "/v1/charges" }));

    const res = await app.fetch(new Request("http://x/_activity/recent.json?service=github&limit=5"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ActivityEvent[] };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e) => e.service === "github")).toBe(true);
  });

  it("opens an SSE stream with the right content-type and a connected preamble", async () => {
    const res = await app.fetch(new Request("http://x/_activity/stream"));
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(": connected");
    // cancel() triggers the stream's teardown so the heartbeat interval clears.
    await reader.cancel();
  });

  it("streams published events as `data:` frames, scoped by ?service=", async () => {
    const res = await app.fetch(new Request("http://x/_activity/stream?service=slack"));
    const reader = res.body!.getReader();
    await reader.read(); // drain the ": connected" preamble

    activityBus.publish(evt({ service: "okta", id: "skip-me" }));
    activityBus.publish(evt({ service: "slack", id: "keep-me", entity: "/chat.postMessage" }));

    // Read until we observe the in-scope event (the out-of-scope one is filtered out).
    let buf = "";
    for (let i = 0; i < 5 && !buf.includes("keep-me"); i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    expect(buf).toContain("data:");
    expect(buf).toContain("keep-me");
    expect(buf).not.toContain("skip-me");
    await reader.cancel();
  });
});

describe("renderActivityCard", () => {
  it("renders a card with the live-stream script wired to /_activity/stream", () => {
    const html = renderActivityCard({ limit: 10 });
    expect(html).toContain("Live Activity");
    expect(html).toContain("EventSource('/_activity/stream')");
  });
});
