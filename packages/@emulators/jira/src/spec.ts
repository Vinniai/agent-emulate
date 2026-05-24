import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "jira", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "jira",
  tokenPath: "/oauth/token",
  tokenPrefix: "jira",
  connectionConfig: {
    cloud_id: "1f4e0a8e-d100-4c93-a8b6-acme00000000",
    site_url: "https://acme.atlassian.net",
  },
  dialect: "jira",
  models: [
    {
      model: "Issue",
      collectionPath: "/rest/api/3/issue",
      idField: "id",
      rows: [
        {
          id: "10001",
          key: "ACME-1",
          fields: {
            summary: "Add SSO via Okta",
            status: {
              name: "In Progress",
              statusCategory: {
                key: "indeterminate",
              },
            },
            priority: {
              name: "High",
            },
            assignee: {
              displayName: "Priya Anand",
              emailAddress: "priya@agent-emulate.dev",
            },
            created: "2025-11-18T10:00:00.000+0000",
          },
        },
        {
          id: "10002",
          key: "ACME-2",
          fields: {
            summary: "Stripe webhook retry storm",
            status: {
              name: "To Do",
              statusCategory: {
                key: "new",
              },
            },
            priority: {
              name: "Critical",
            },
            assignee: null,
            created: "2025-12-01T12:30:00.000+0000",
          },
        },
      ],
    },
    {
      model: "Project",
      collectionPath: "/rest/api/3/project",
      idField: "id",
      rows: [
        {
          id: "10000",
          key: "ACME",
          name: "Acme Platform",
          projectTypeKey: "software",
          style: "classic",
        },
      ],
    },
  ],
};
