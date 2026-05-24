import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "airtable", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "airtable",
  tokenPath: "/oauth/token",
  tokenPrefix: "airt",
  connectionConfig: {
    base_id: "appacme0000000001",
  },
  models: [
    {
      model: "Record",
      collectionPath: "/v0/BASE/Records",
      idField: "id",
      rows: [
        {
          id: "rec0acmeContact01",
          fields: {
            Name: "Priya Anand",
            Email: "priya@agent-emulate.dev",
            Stage: "Customer",
          },
          createdTime: "2025-09-14T10:12:00.000Z",
        },
        {
          id: "rec0acmeContact02",
          fields: {
            Name: "Tomas Eriksen",
            Email: "tomas@agent-emulate.dev",
            Stage: "Trialing",
          },
          createdTime: "2025-10-04T14:30:00.000Z",
        },
      ],
    },
  ],
};
