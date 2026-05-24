import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "box", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "box",
  tokenPath: "/oauth/token",
  tokenPrefix: "box",
  connectionConfig: {},
  models: [
    {
      model: "File",
      collectionPath: "/2.0/files",
      idField: "id",
      rows: [
        {
          id: "1845032100001",
          type: "file",
          name: "SOC2-evidence-2025.zip",
          size: 84211044,
          sha1: "85136C79CBF9FE36BB9D05D0639C70C265C18D37",
          created_at: "2025-12-02T11:14:00-08:00",
          modified_at: "2025-12-02T12:14:00-08:00",
          created_by: {
            type: "user",
            id: "11000001",
            name: "Priya Anand",
            login: "priya@agent-emulate.dev",
          },
          owned_by: {
            type: "user",
            id: "11000001",
            name: "Priya Anand",
            login: "priya@agent-emulate.dev",
          },
          parent: {
            type: "folder",
            id: "228401000001",
            name: "Compliance",
            sequence_id: "3",
            etag: "1",
          },
        },
        {
          id: "1845032100002",
          type: "file",
          name: "vendor-contract-globex.pdf",
          size: 414221,
          sha1: "12345C79CBF9FE36BB9D05D0639C70C265C18ABC",
          created_at: "2025-11-22T09:00:00-08:00",
          modified_at: "2025-11-22T10:00:00-08:00",
          created_by: {
            type: "user",
            id: "11000002",
            name: "Marco Ruiz",
            login: "marco@agent-emulate.dev",
          },
          owned_by: {
            type: "user",
            id: "11000002",
            name: "Marco Ruiz",
            login: "marco@agent-emulate.dev",
          },
          parent: {
            type: "folder",
            id: "228401000002",
            name: "Contracts",
            sequence_id: "5",
            etag: "2",
          },
        },
      ],
    },
  ],
};
