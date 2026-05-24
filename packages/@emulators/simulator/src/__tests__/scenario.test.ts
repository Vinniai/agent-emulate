import { describe, it, expect } from "vitest";
import { loadScenario } from "../scenario.js";
import { registerGenerator } from "../generators.js";

// ---------------------------------------------------------------------------
// A scenario is the human-editable description of what activity to stream and
// how fast. It accepts YAML or JSON, normalises rate → interval, defaults +
// clamps jitter, and validates the provider/kind enums up front so the engine
// never has to.
// ---------------------------------------------------------------------------

const YAML = `
base: http://nango.localhost:1355
durationSec: 120
streams:
  - name: inbox
    kind: sync
    provider: gmail
    connectionId: gm-acme
    providerConfigKey: google-mail
    model: messages
    ratePerMinute: 30
    jitter: 0.5
    maxCount: 10
  - name: whatsapp-in
    kind: forward
    provider: whatsapp
    connectionId: wa-acme
    providerConfigKey: whatsapp
    environmentUuid: env-1
    ratePerMinute: 6
`;

describe("loadScenario — parsing", () => {
  it("parses YAML and normalises rate → interval", () => {
    const s = loadScenario(YAML);
    expect(s.base).toBe("http://nango.localhost:1355");
    expect(s.durationSec).toBe(120);
    expect(s.streams).toHaveLength(2);

    const inbox = s.streams[0];
    expect(inbox).toMatchObject({
      name: "inbox",
      kind: "sync",
      provider: "gmail",
      connectionId: "gm-acme",
      providerConfigKey: "google-mail",
      model: "messages",
      maxCount: 10,
    });
    expect(inbox.intervalMs).toBe(2000); // 60000 / 30
    expect(inbox.jitter).toBe(0.5);
  });

  it("parses equivalent JSON identically", () => {
    const json = JSON.stringify({
      base: "http://x",
      streams: [
        {
          name: "a",
          kind: "sync",
          provider: "drive",
          connectionId: "c",
          providerConfigKey: "k",
          model: "files",
          ratePerMinute: 60,
        },
      ],
    });
    const s = loadScenario(json);
    expect(s.streams[0].intervalMs).toBe(1000);
    expect(s.streams[0].jitter).toBe(0); // default
  });
});

describe("loadScenario — normalisation & validation", () => {
  it("clamps jitter into [0,1]", () => {
    const s = loadScenario(
      JSON.stringify({
        streams: [
          {
            name: "a",
            kind: "sync",
            provider: "gmail",
            connectionId: "c",
            providerConfigKey: "k",
            model: "messages",
            ratePerMinute: 60,
            jitter: 9,
          },
          {
            name: "b",
            kind: "sync",
            provider: "gmail",
            connectionId: "c",
            providerConfigKey: "k",
            model: "messages",
            ratePerMinute: 60,
            jitter: -3,
          },
        ],
      }),
    );
    expect(s.streams[0].jitter).toBe(1);
    expect(s.streams[1].jitter).toBe(0);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      loadScenario(
        JSON.stringify({
          streams: [
            {
              name: "a",
              kind: "sync",
              provider: "myspace",
              connectionId: "c",
              providerConfigKey: "k",
              ratePerMinute: 1,
            },
          ],
        }),
      ),
    ).toThrow(/provider/i);
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      loadScenario(
        JSON.stringify({
          streams: [
            {
              name: "a",
              kind: "telepathy",
              provider: "gmail",
              connectionId: "c",
              providerConfigKey: "k",
              ratePerMinute: 1,
            },
          ],
        }),
      ),
    ).toThrow(/kind/i);
  });

  it("rejects a non-positive rate", () => {
    expect(() =>
      loadScenario(
        JSON.stringify({
          streams: [
            { name: "a", kind: "sync", provider: "gmail", connectionId: "c", providerConfigKey: "k", ratePerMinute: 0 },
          ],
        }),
      ),
    ).toThrow(/rate/i);
  });

  it("requires at least one stream", () => {
    expect(() => loadScenario(JSON.stringify({ streams: [] }))).toThrow(/stream/i);
  });

  it("accepts business providers from the generator registry with no schema change", () => {
    const s = loadScenario(
      JSON.stringify({
        streams: [
          {
            name: "inv",
            kind: "sync",
            provider: "xero",
            connectionId: "c",
            providerConfigKey: "xero",
            model: "invoices",
            ratePerMinute: 10,
          },
          {
            name: "iss",
            kind: "sync",
            provider: "jira",
            connectionId: "c",
            providerConfigKey: "jira",
            model: "issues",
            ratePerMinute: 10,
          },
        ],
      }),
    );
    expect(s.streams.map((x) => x.provider)).toEqual(["xero", "jira"]);
  });

  it("accepts a provider added at runtime via registerGenerator", () => {
    registerGenerator("scenario-custom", (seq) => ({ kind: "sync", model: "things", record: { id: seq } }));
    const s = loadScenario(
      JSON.stringify({
        streams: [
          {
            name: "x",
            kind: "sync",
            provider: "scenario-custom",
            connectionId: "c",
            providerConfigKey: "k",
            model: "things",
            ratePerMinute: 5,
          },
        ],
      }),
    );
    expect(s.streams[0].provider).toBe("scenario-custom");
  });

  it("requires a model for sync streams and environmentUuid for forward streams", () => {
    expect(() =>
      loadScenario(
        JSON.stringify({
          streams: [
            { name: "a", kind: "sync", provider: "gmail", connectionId: "c", providerConfigKey: "k", ratePerMinute: 1 },
          ],
        }),
      ),
    ).toThrow(/model/i);
    expect(() =>
      loadScenario(
        JSON.stringify({
          streams: [
            {
              name: "a",
              kind: "forward",
              provider: "whatsapp",
              connectionId: "c",
              providerConfigKey: "k",
              ratePerMinute: 1,
            },
          ],
        }),
      ),
    ).toThrow(/environmentUuid/i);
  });

  it("accepts a native stream without connectionId / providerConfigKey / model", () => {
    const s = loadScenario(
      JSON.stringify({
        streams: [
          {
            name: "gh",
            kind: "native",
            provider: "github-issues",
            pathPrefix: "/github",
            ratePerMinute: 30,
            maxCount: 4,
          },
        ],
      }),
    );
    expect(s.streams[0].kind).toBe("native");
    expect(s.streams[0].pathPrefix).toBe("/github");
    expect(s.streams[0].connectionId).toBe("");
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      loadScenario(JSON.stringify({ streams: [{ kind: "telepathy", provider: "gmail", ratePerMinute: 1 }] })),
    ).toThrow(/kind must be/i);
  });
});
