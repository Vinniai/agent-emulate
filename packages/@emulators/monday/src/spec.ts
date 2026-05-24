import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "monday", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "monday",
  tokenPath: "/oauth/token",
  tokenPrefix: "mond",
  connectionConfig: {},
  models: [
    {
      model: "Item",
      collectionPath: "/items",
      idField: "id",
      rows: [
        {
          id: "8800000001",
          name: "Renew vendor agreement — AWS",
          board: {
            id: "1100000010",
            name: "Procurement",
          },
          group: {
            id: "topics",
            title: "Open contracts",
          },
          column_values: [
            {
              id: "status",
              text: "Working on it",
              value: '{"index":1}',
            },
            {
              id: "date",
              text: "2026-01-31",
              value: '{"date":"2026-01-31"}',
            },
          ],
        },
      ],
    },
  ],
};
