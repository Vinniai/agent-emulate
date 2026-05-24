import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "lever", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "lever",
  tokenPath: "/oauth/token",
  tokenPrefix: "leve",
  connectionConfig: {},
  models: [
    {
      model: "Opportunity",
      collectionPath: "/v1/opportunities",
      idField: "id",
      rows: [
        {
          id: "4f3a8b0c-1234-5678-90ab-acme00000001",
          name: "Hannah Cohen",
          headline: "Senior Backend Engineer @ Aurora Labs",
          stage: {
            id: "b0c22d5e-5f4e-4c6e-bb3a-acmeSTAGE0001",
            text: "Onsite Interview",
          },
          posting: "6a1e4b79-75a3-454f-9417-acmePOSTING001",
          contact: "c38e60e9-5992-45e5-8f81-acmeCONTACT001",
          emails: ["hannah@agent-emulate.dev"],
          archived: null,
          createdAt: 1730707200000,
          lastInteractionAt: 1733049240000,
          origin: "applied",
        },
      ],
    },
  ],
};
