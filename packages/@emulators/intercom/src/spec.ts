import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "intercom", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "intercom",
  tokenPath: "/oauth/token",
  tokenPrefix: "inte",
  connectionConfig: {},
  models: [
    {
      model: "Contact",
      collectionPath: "/contacts",
      idField: "id",
      rows: [
        {
          id: "65a0a8e0c0b1d2e3f4a5b6c0",
          type: "contact",
          role: "user",
          email: "priya@agent-emulate.dev",
          name: "Priya Anand",
          created_at: 1726309920,
        },
      ],
    },
    {
      model: "Conversation",
      collectionPath: "/conversations",
      idField: "id",
      rows: [
        {
          id: "199900001",
          type: "conversation",
          state: "open",
          source: {
            type: "email",
            subject: "Pricing question",
          },
          contacts: {
            contacts: [
              {
                id: "65a0a8e0c0b1d2e3f4a5b6c0",
              },
            ],
          },
          created_at: 1733049240,
        },
      ],
    },
  ],
};
