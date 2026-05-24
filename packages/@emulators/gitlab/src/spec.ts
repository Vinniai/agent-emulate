import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "gitlab", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "gitlab",
  tokenPath: "/oauth/token",
  tokenPrefix: "gitl",
  connectionConfig: {
    instance_url: "https://gitlab.com",
  },
  models: [
    {
      model: "Project",
      collectionPath: "/api/v4/projects",
      idField: "id",
      rows: [
        {
          id: 50100001,
          description: "Acme HTTP API",
          name: "api",
          path: "api",
          path_with_namespace: "acme/api",
          default_branch: "main",
          visibility: "private",
          ssh_url_to_repo: "git@gitlab.com:acme/api.git",
          http_url_to_repo: "https://gitlab.com/acme/api.git",
          web_url: "https://gitlab.com/acme/api",
          created_at: "2024-04-01T09:00:00Z",
          last_activity_at: "2025-12-02T11:14:00.000Z",
          namespace: {
            id: 8800001,
            name: "Acme",
            path: "acme",
            kind: "group",
            full_path: "acme",
            web_url: "https://gitlab.com/groups/acme",
          },
        },
      ],
    },
    {
      model: "Issue",
      collectionPath: "/api/v4/issues",
      idField: "id",
      rows: [
        {
          id: 70100001,
          iid: 17,
          project_id: 50100001,
          title: "Migrate runners to fleet 2.0",
          description: "We need to roll the shared runners onto the fleet 2.0 images.",
          state: "opened",
          assignees: [
            {
              id: 1000001,
              username: "priya",
              name: "Priya Anand",
              state: "active",
              avatar_url: "https://gitlab.com/uploads/-/system/user/avatar/1000001/avatar.png",
              web_url: "https://gitlab.com/priya",
            },
          ],
          author: {
            id: 1000001,
            username: "priya",
            name: "Priya Anand",
          },
          labels: ["infra", "priority::high"],
          milestone: null,
          created_at: "2025-11-22T08:00:00.000Z",
          updated_at: "2025-12-02T11:14:00.000Z",
          web_url: "https://gitlab.com/acme/api/-/issues/17",
        },
      ],
    },
  ],
};
