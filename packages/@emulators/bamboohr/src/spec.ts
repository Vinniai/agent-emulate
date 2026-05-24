import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "bamboohr", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "bamboohr",
  tokenPath: "/oauth/token",
  tokenPrefix: "bamb",
  connectionConfig: {
    subdomain: "acme",
  },
  models: [
    {
      model: "Employee",
      collectionPath: "/api/v1/employees",
      idField: "id",
      rows: [
        {
          id: "401",
          firstName: "Priya",
          lastName: "Anand",
          workEmail: "priya@agent-emulate.dev",
          jobTitle: "VP Engineering",
          department: "Engineering",
          hireDate: "2022-04-11",
          employmentHistoryStatus: "Active",
        },
        {
          id: "402",
          firstName: "Marco",
          lastName: "Ruiz",
          workEmail: "marco@agent-emulate.dev",
          jobTitle: "Director of Operations",
          department: "Operations",
          hireDate: "2021-09-01",
          employmentHistoryStatus: "Active",
        },
      ],
    },
  ],
};
