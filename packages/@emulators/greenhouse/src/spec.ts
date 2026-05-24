import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "greenhouse", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "greenhouse",
  tokenPath: "/oauth/token",
  tokenPrefix: "gree",
  connectionConfig: {},
  models: [
    {
      model: "Candidate",
      collectionPath: "/v1/candidates",
      idField: "id",
      rows: [
        {
          id: 88800001,
          first_name: "Hannah",
          last_name: "Cohen",
          email_addresses: [
            {
              value: "hannah@agent-emulate.dev",
              type: "personal",
            },
          ],
          applications: [
            {
              id: 90010001,
              status: "active",
              current_stage: {
                id: 7,
                name: "Onsite Interview",
              },
              jobs: [
                {
                  id: 1010,
                  name: "Senior Backend Engineer",
                },
              ],
            },
          ],
          created_at: "2025-11-04T10:00:00Z",
        },
      ],
    },
    {
      model: "Job",
      collectionPath: "/v1/jobs",
      idField: "id",
      rows: [
        {
          id: 1010,
          name: "Senior Backend Engineer",
          status: "open",
          departments: [
            {
              id: 20,
              name: "Engineering",
            },
          ],
          offices: [
            {
              id: 4,
              name: "Remote — US",
            },
          ],
        },
      ],
    },
  ],
};
