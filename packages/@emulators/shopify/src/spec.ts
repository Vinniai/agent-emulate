import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "shopify", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "shopify",
  tokenPath: "/admin/oauth/access_token",
  tokenPrefix: "shop",
  connectionConfig: {
    shop: "acme-supply.myshopify.com",
  },
  dialect: "shopify",
  models: [
    {
      model: "Product",
      collectionPath: "/admin/api/2024-01/products",
      idField: "id",
      rows: [
        {
          id: 7702000000001,
          title: "Acme Supply Kit",
          handle: "acme-supply-kit",
          product_type: "Kits",
          vendor: "Acme Supply",
          status: "active",
          variants: [
            {
              id: 41200000001,
              price: "49.00",
              sku: "ACME-KIT-01",
              inventory_quantity: 240,
            },
          ],
        },
        {
          id: 7702000000002,
          title: "Acme Spare Bundle",
          handle: "acme-spare-bundle",
          product_type: "Bundles",
          vendor: "Acme Supply",
          status: "active",
          variants: [
            {
              id: 41200000002,
              price: "19.00",
              sku: "ACME-SPARE-02",
              inventory_quantity: 1020,
            },
          ],
        },
      ],
    },
    {
      model: "Order",
      collectionPath: "/admin/api/2024-01/orders",
      idField: "id",
      rows: [
        {
          id: 5301000000001,
          name: "#1001",
          email: "priya@agent-emulate.dev",
          financial_status: "paid",
          fulfillment_status: "fulfilled",
          total_price: "49.00",
          subtotal_price: "49.00",
          currency: "USD",
          customer: {
            id: 4400000000001,
            email: "priya@agent-emulate.dev",
            first_name: "Priya",
            last_name: "Anand",
            created_at: "2025-09-14T10:12:00-08:00",
          },
          line_items: [
            {
              id: 13900000001,
              title: "Acme Supply Kit",
              quantity: 1,
              price: "49.00",
              sku: "ACME-KIT-01",
              variant_id: 41200000001,
              product_id: 7702000000001,
            },
          ],
          created_at: "2025-12-01T10:14:00-08:00",
          updated_at: "2025-12-01T10:14:00-08:00",
          processed_at: "2025-12-01T10:14:00-08:00",
        },
      ],
    },
  ],
};
