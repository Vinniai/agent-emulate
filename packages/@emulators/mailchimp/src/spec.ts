import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "mailchimp", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "mailchimp",
  tokenPath: "/oauth/token",
  tokenPrefix: "mail",
  connectionConfig: {
    dc: "us21",
  },
  models: [
    {
      model: "Member",
      collectionPath: "/3.0/lists/LIST/members",
      idField: "id",
      rows: [
        {
          id: "4f0a8e0c0b1d2e3f4a5b6c7d8e9f0a1b",
          email_address: "priya@agent-emulate.dev",
          unique_email_id: "c8f2a90b1d",
          contact_id: "33c8f2a90b1d4f00ac01b6e0",
          full_name: "Priya Anand",
          web_id: 4400123,
          email_type: "html",
          status: "subscribed",
          merge_fields: {
            FNAME: "Priya",
            LNAME: "Anand",
          },
          stats: {
            avg_open_rate: 0.42,
            avg_click_rate: 0.11,
          },
          ip_signup: "203.0.113.10",
          timestamp_signup: "2025-09-14T10:12:00+00:00",
          list_id: "1a2b3c4d5e",
        },
        {
          id: "5b1f9d1d1c2e3f4a5b6c7d8e9f0a1b2c",
          email_address: "tomas@agent-emulate.dev",
          unique_email_id: "d0a3b81c2e",
          contact_id: "44d0a3b81c2e4f00ac02b6e1",
          full_name: "Tomas Eriksen",
          web_id: 4400124,
          email_type: "html",
          status: "subscribed",
          merge_fields: {
            FNAME: "Tomas",
            LNAME: "Eriksen",
          },
          stats: {
            avg_open_rate: 0.38,
            avg_click_rate: 0.09,
          },
          ip_signup: "203.0.113.22",
          timestamp_signup: "2025-10-04T14:30:00+00:00",
          list_id: "1a2b3c4d5e",
        },
      ],
    },
    {
      model: "Campaign",
      collectionPath: "/3.0/campaigns",
      idField: "id",
      rows: [
        {
          id: "9f8e7d6c5b",
          web_id: 220011,
          type: "regular",
          create_time: "2025-11-10T18:00:00+00:00",
          send_time: "2025-11-12T08:00:00+00:00",
          status: "sent",
          emails_sent: 12450,
          archive_url: "https://mailchi.mp/acme/november-product-update",
          recipients: {
            list_id: "1a2b3c4d5e",
            list_name: "Acme newsletter",
          },
          settings: {
            subject_line: "November product update",
            preview_text: "Whats new at Acme",
            title: "2025-11 Newsletter",
            from_name: "Acme Team",
            reply_to: "hello@agent-emulate.dev",
          },
        },
      ],
    },
  ],
};
