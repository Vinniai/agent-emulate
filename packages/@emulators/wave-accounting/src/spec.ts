import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "wave-accounting", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "wave-accounting",
  tokenPath: "/oauth/token",
  tokenPrefix: "wave",
  connectionConfig: {
    business_id: "QnVzaW5lc3M6YWNtZS1kZW1v",
  },
  models: [
    {
      model: "Invoice",
      collectionPath: "/invoices",
      idField: "id",
      rows: [
        {
          id: "SW52b2ljZTphY21lLTAwMQ==",
          invoiceNumber: "WAV-2025-001",
          status: "SAVED",
          total: {
            value: "560.00",
            currency: {
              code: "USD",
            },
          },
          amountDue: {
            value: "560.00",
            currency: {
              code: "USD",
            },
          },
          invoiceDate: "2025-11-20",
          dueDate: "2025-12-20",
        },
        {
          id: "SW52b2ljZTphY21lLTAwMg==",
          invoiceNumber: "WAV-2025-002",
          status: "PAID",
          total: {
            value: "1280.00",
            currency: {
              code: "USD",
            },
          },
          amountDue: {
            value: "0.00",
            currency: {
              code: "USD",
            },
          },
          invoiceDate: "2025-10-04",
          dueDate: "2025-11-04",
        },
      ],
    },
  ],
};
