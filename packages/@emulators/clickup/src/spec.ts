import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "clickup", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "clickup",
  tokenPath: "/oauth/token",
  tokenPrefix: "clic",
  connectionConfig: {
    workspace_id: "9001234",
  },
  models: [
    {
      model: "Task",
      collectionPath: "/api/v2/task",
      idField: "id",
      rows: [
        {
          id: "abc123",
          name: "Ship onboarding tour",
          status: {
            status: "in progress",
            color: "#fbbf24",
            type: "custom",
            orderindex: 1,
          },
          assignees: [
            {
              id: "90011",
              username: "priya",
              email: "priya@agent-emulate.dev",
              color: "#7b68ee",
              profilePicture: null,
            },
          ],
          due_date: "1735603200000",
          list: {
            id: "1500001",
            name: "Growth",
          },
          archived: false,
          priority: null,
          time_estimate: null,
          url: "https://app.clickup.com/t/abc123",
        },
      ],
    },
  ],
};
