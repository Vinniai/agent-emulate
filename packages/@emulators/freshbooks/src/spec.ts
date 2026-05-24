import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "freshbooks", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "freshbooks",
  tokenPath: "/oauth/token",
  tokenPrefix: "fres",
  connectionConfig: {
    account_id: "ABCxyz123",
  },
  models: [
    {
      model: "Invoice",
      collectionPath: "/accounting/account/ACME/invoices/invoices",
      idField: "id",
      rows: [
        {
          id: 7001,
          invoice_number: "INV-7001",
          amount: {
            amount: "1450.00",
            code: "USD",
          },
          outstanding: {
            amount: "0.00",
            code: "USD",
          },
          status: 4,
          v3_status: "paid",
          organization: "Acme Corp",
          create_date: "2025-09-15",
          due_date: "2025-10-15",
        },
        {
          id: 7002,
          invoice_number: "INV-7002",
          amount: {
            amount: "3200.00",
            code: "USD",
          },
          outstanding: {
            amount: "3200.00",
            code: "USD",
          },
          status: 2,
          v3_status: "sent",
          organization: "Globex Manufacturing",
          create_date: "2025-11-01",
          due_date: "2025-12-01",
        },
      ],
    },
  ],
};
