import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "mixpanel", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "mixpanel",
  tokenPath: "/oauth/token",
  tokenPrefix: "mixp",
  connectionConfig: {
    project_id: "3200000",
  },
  models: [
    {
      model: "Event",
      collectionPath: "/api/2.0/events",
      idField: "id",
      rows: [
        {
          event: "Signed Up",
          properties: {
            time: 1726309920,
            distinct_id: "priya@agent-emulate.dev",
            $insert_id: "8a0b1c2d3e4f5061acme00000001",
            $source: "organic",
            $browser: "Chrome",
            plan: "free",
          },
        },
        {
          event: "Upgraded Plan",
          properties: {
            time: 1731504000,
            distinct_id: "priya@agent-emulate.dev",
            $insert_id: "8a0b1c2d3e4f5061acme00000002",
            $source: "in_app",
            $browser: "Chrome",
            from: "free",
            to: "pro",
            mrr: 49,
          },
        },
      ],
    },
  ],
};
