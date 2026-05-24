import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "linear", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "linear",
  tokenPath: "/oauth/token",
  tokenPrefix: "line",
  connectionConfig: {},
  models: [
    {
      model: "Issue",
      collectionPath: "/issues",
      idField: "id",
      rows: [
        {
          id: "6f8a1b2c-3d4e-5f60-7180-acme00000001",
          identifier: "ENG-101",
          title: "Migrate webhooks to v2 schema",
          description: null,
          priority: 2,
          state: {
            id: "8a0b1c2d-3e4f-5061-7283-acmeSTATE0002",
            name: "In Progress",
            type: "started",
            color: "#f2c94c",
          },
          assignee: {
            id: "7b1c2d3e-4f50-6172-8394-acmeUSER0001",
            name: "Priya Anand",
            email: "priya@agent-emulate.dev",
            displayName: "priya",
          },
          team: {
            id: "5c4d3e2f-1a0b-9c8d-7e6f-acmeTEAM0001",
            key: "ENG",
            name: "Engineering",
          },
          createdAt: "2025-11-18T10:00:00.000Z",
          updatedAt: "2025-12-02T11:14:00.000Z",
          archivedAt: null,
        },
        {
          id: "6f8a1b2c-3d4e-5f60-7180-acme00000002",
          identifier: "ENG-102",
          title: "Add audit log table",
          description: null,
          priority: 3,
          state: {
            id: "8a0b1c2d-3e4f-5061-7283-acmeSTATE0001",
            name: "Backlog",
            type: "backlog",
            color: "#bec2c8",
          },
          assignee: null,
          team: {
            id: "5c4d3e2f-1a0b-9c8d-7e6f-acmeTEAM0001",
            key: "ENG",
            name: "Engineering",
          },
          createdAt: "2025-11-25T16:00:00.000Z",
          updatedAt: "2025-11-25T16:00:00.000Z",
          archivedAt: null,
        },
      ],
    },
  ],
};
