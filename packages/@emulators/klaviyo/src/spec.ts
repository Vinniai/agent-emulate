import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "klaviyo", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "klaviyo",
  tokenPath: "/oauth/token",
  tokenPrefix: "klav",
  connectionConfig: {},
  models: [
    {
      model: "Profile",
      collectionPath: "/api/profiles",
      idField: "id",
      rows: [
        {
          id: "01HXYZACMEPROFILE01",
          type: "profile",
          attributes: {
            email: "priya@agent-emulate.dev",
            first_name: "Priya",
            last_name: "Anand",
            created: "2025-09-14T10:12:00+00:00",
          },
        },
        {
          id: "01HXYZACMEPROFILE02",
          type: "profile",
          attributes: {
            email: "tomas@agent-emulate.dev",
            first_name: "Tomas",
            last_name: "Eriksen",
            created: "2025-10-04T14:30:00+00:00",
          },
        },
      ],
    },
  ],
};
