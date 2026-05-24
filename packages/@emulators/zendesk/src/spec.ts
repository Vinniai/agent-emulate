import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "zendesk", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "zendesk",
  tokenPath: "/oauth/token",
  tokenPrefix: "zend",
  connectionConfig: {
    subdomain: "acme",
  },
  dialect: "zendesk",
  models: [
    {
      model: "Ticket",
      collectionPath: "/api/v2/tickets",
      idField: "id",
      rows: [
        {
          id: 30041,
          subject: "Cannot log in after SSO change",
          status: "open",
          priority: "high",
          requester_id: 4400001,
          assignee_id: 100001,
          created_at: "2025-12-01T13:14:00Z",
          tags: ["auth", "sso"],
        },
        {
          id: 30042,
          subject: "Refund request for INV-7001",
          status: "pending",
          priority: "normal",
          requester_id: 4400002,
          assignee_id: null,
          created_at: "2025-12-02T09:01:00Z",
          tags: ["billing", "refund"],
        },
      ],
    },
    {
      model: "User",
      collectionPath: "/api/v2/users",
      idField: "id",
      rows: [
        {
          id: 4400001,
          name: "Priya Anand",
          email: "priya@agent-emulate.dev",
          role: "end-user",
        },
        {
          id: 4400002,
          name: "Tomas Eriksen",
          email: "tomas@agent-emulate.dev",
          role: "end-user",
        },
      ],
    },
  ],
};
