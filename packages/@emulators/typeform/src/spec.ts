import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "typeform", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "typeform",
  tokenPath: "/oauth/token",
  tokenPrefix: "type",
  connectionConfig: {},
  models: [
    {
      model: "Form",
      collectionPath: "/forms",
      idField: "id",
      rows: [
        {
          id: "AcmeQ4",
          title: "Acme Q4 customer survey",
          language: "en",
          workspace: {
            href: "https://api.typeform.com/workspaces/acme",
          },
          created_at: "2025-09-01T09:00:00Z",
        },
      ],
    },
    {
      model: "Response",
      collectionPath: "/forms/FORM/responses",
      idField: "id",
      rows: [
        {
          response_id: "01HXYZACMERESP001",
          submitted_at: "2025-11-12T14:02:00Z",
          answers: [
            {
              field: {
                id: "nps",
                type: "opinion_scale",
              },
              type: "number",
              number: 9,
            },
            {
              field: {
                id: "feedback",
                type: "long_text",
              },
              type: "text",
              text: "Love the new dashboard.",
            },
          ],
        },
      ],
    },
  ],
};
