import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "sendgrid", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "sendgrid",
  tokenPath: "/oauth/token",
  tokenPrefix: "send",
  connectionConfig: {},
  models: [
    {
      model: "Contact",
      collectionPath: "/v3/marketing/contacts",
      idField: "id",
      rows: [
        {
          id: "0c8b0e0a-1234-5678-90ab-cdef00000001",
          email: "priya@agent-emulate.dev",
          alternate_emails: [],
          first_name: "Priya",
          last_name: "Anand",
          list_ids: ["b6f3b7a0-0001-4f00-9c00-acme00000001"],
          segment_ids: [],
          custom_fields: {},
          created_at: "2025-09-14T10:12:00Z",
          updated_at: "2025-09-14T10:12:00Z",
          _metadata: {
            self: "https://api.sendgrid.com/v3/marketing/contacts/0c8b0e0a-1234-5678-90ab-cdef00000001",
          },
        },
        {
          id: "0c8b0e0a-1234-5678-90ab-cdef00000002",
          email: "tomas@agent-emulate.dev",
          alternate_emails: [],
          first_name: "Tomas",
          last_name: "Eriksen",
          list_ids: ["b6f3b7a0-0001-4f00-9c00-acme00000001", "b6f3b7a0-0002-4f00-9c00-acme00000002"],
          segment_ids: [],
          custom_fields: {},
          created_at: "2025-10-04T14:30:00Z",
          updated_at: "2025-10-04T14:30:00Z",
          _metadata: {
            self: "https://api.sendgrid.com/v3/marketing/contacts/0c8b0e0a-1234-5678-90ab-cdef00000002",
          },
        },
      ],
    },
  ],
};
