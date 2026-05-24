import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "pipedrive", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "pipedrive",
  tokenPath: "/oauth/token",
  tokenPrefix: "pipe",
  connectionConfig: {
    api_domain: "https://acme.pipedrive.com",
  },
  models: [
    {
      model: "Person",
      collectionPath: "/v1/persons",
      idField: "id",
      rows: [
        {
          id: 101,
          name: "Priya Anand",
          emails: [
            {
              value: "priya@agent-emulate.dev",
              primary: true,
              label: "work",
            },
          ],
          phones: [
            {
              value: "+1-555-0142",
              primary: true,
              label: "work",
            },
          ],
          org_id: 9001,
          owner_id: 1,
          visible_to: 1,
          add_time: "2025-09-14T10:12:00Z",
          update_time: "2025-09-14T10:12:00Z",
        },
        {
          id: 102,
          name: "Tomas Eriksen",
          emails: [
            {
              value: "tomas@agent-emulate.dev",
              primary: true,
              label: "work",
            },
          ],
          phones: [
            {
              value: "+46-70-555-0188",
              primary: true,
              label: "mobile",
            },
          ],
          org_id: 9002,
          owner_id: 1,
          visible_to: 1,
          add_time: "2025-10-04T14:30:00Z",
          update_time: "2025-10-04T14:30:00Z",
        },
      ],
    },
    {
      model: "Deal",
      collectionPath: "/v1/deals",
      idField: "id",
      rows: [
        {
          id: 5001,
          title: "Onboarding subscription — Acme HQ",
          value: 24000,
          currency: "USD",
          status: "open",
          stage_id: 3,
          person_id: 101,
          org_id: 9001,
          add_time: "2025-11-01 09:00:00",
        },
        {
          id: 5002,
          title: "Renewal — Globex North",
          value: 96000,
          currency: "USD",
          status: "open",
          stage_id: 4,
          person_id: 102,
          org_id: 9002,
          add_time: "2025-11-12 13:45:00",
        },
      ],
    },
  ],
};
