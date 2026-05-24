import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "asana", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "asana",
  tokenPath: "/oauth/token",
  tokenPrefix: "asan",
  connectionConfig: {
    workspace_gid: "1200000000000001",
  },
  models: [
    {
      model: "Task",
      collectionPath: "/api/1.0/tasks",
      idField: "gid",
      rows: [
        {
          gid: "1200000000001001",
          resource_type: "task",
          name: "Draft Q1 launch plan",
          completed: false,
          assignee: {
            gid: "100000001",
            resource_type: "user",
            name: "Priya Anand",
          },
          projects: [
            {
              gid: "1200000000000010",
              resource_type: "project",
              name: "Q1 Launch",
            },
          ],
          workspace: {
            gid: "1200000000000001",
            resource_type: "workspace",
            name: "Acme",
          },
          due_on: "2025-12-31",
          due_at: null,
          created_at: "2025-11-04T10:00:00.000Z",
          modified_at: "2025-11-22T14:00:00.000Z",
        },
        {
          gid: "1200000000001002",
          resource_type: "task",
          name: "Hire two SDRs",
          completed: false,
          assignee: {
            gid: "100000002",
            resource_type: "user",
            name: "Marco Ruiz",
          },
          projects: [
            {
              gid: "1200000000000011",
              resource_type: "project",
              name: "GTM Ops",
            },
          ],
          workspace: {
            gid: "1200000000000001",
            resource_type: "workspace",
            name: "Acme",
          },
          due_on: "2026-01-15",
          due_at: null,
          created_at: "2025-11-12T09:00:00.000Z",
          modified_at: "2025-12-01T16:00:00.000Z",
        },
      ],
    },
  ],
};
