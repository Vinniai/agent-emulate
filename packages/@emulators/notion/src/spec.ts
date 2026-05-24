import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "notion", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "notion",
  tokenPath: "/oauth/token",
  tokenPrefix: "noti",
  connectionConfig: {},
  models: [
    {
      model: "Page",
      collectionPath: "/v1/pages",
      idField: "id",
      rows: [
        {
          object: "page",
          id: "9e1a2b3c-4d5e-6f70-8190-acme00000001",
          created_time: "2025-09-01T10:00:00.000Z",
          last_edited_time: "2025-12-02T11:14:00.000Z",
          archived: false,
          in_trash: false,
          url: "https://www.notion.so/acme/Runbook-9e1a2b3c",
          public_url: null,
          icon: {
            type: "emoji",
            emoji: "",
          },
          cover: null,
          parent: {
            type: "database_id",
            database_id: "a1b2c3d4-e5f6-7890-1234-acme00000010",
          },
          properties: {
            Name: {
              id: "title",
              type: "title",
              title: [
                {
                  type: "text",
                  text: {
                    content: "Runbook — Production incidents",
                    link: null,
                  },
                  plain_text: "Runbook — Production incidents",
                  href: null,
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default",
                  },
                },
              ],
            },
            Owner: {
              id: "M%3BBw",
              type: "people",
              people: [
                {
                  object: "user",
                  id: "0f1a2b3c-4d5e-6f70-8190-acmeUSER0001",
                  name: "Priya Anand",
                  type: "person",
                },
              ],
            },
          },
        },
      ],
    },
    {
      model: "Database",
      collectionPath: "/v1/databases",
      idField: "id",
      rows: [
        {
          object: "database",
          id: "a1b2c3d4-e5f6-7890-1234-acme00000010",
          title: [
            {
              type: "text",
              text: {
                content: "Engineering Standups",
                link: null,
              },
              plain_text: "Engineering Standups",
              href: null,
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default",
              },
            },
          ],
          parent: {
            type: "workspace",
            workspace: true,
          },
        },
      ],
    },
  ],
};
