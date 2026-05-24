import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "dropbox", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "dropbox",
  tokenPath: "/oauth/token",
  tokenPrefix: "drop",
  connectionConfig: {},
  models: [
    {
      model: "File",
      collectionPath: "/2/files",
      idField: "id",
      rows: [
        {
          ".tag": "file",
          id: "id:a4ayc_80_OEAAAAAAAAAYa",
          name: "2025-Q4-board-deck.pdf",
          path_lower: "/board/2025-q4-board-deck.pdf",
          path_display: "/Board/2025-Q4-board-deck.pdf",
          client_modified: "2025-12-01T15:02:00Z",
          server_modified: "2025-12-01T15:02:05Z",
          rev: "0123456789abcdef",
          size: 2418293,
          content_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          is_downloadable: true,
        },
        {
          ".tag": "file",
          id: "id:b5bzd_91_PEBBBBBBBBBZb",
          name: "Onboarding-checklist.docx",
          path_lower: "/hr/onboarding-checklist.docx",
          path_display: "/HR/Onboarding-checklist.docx",
          client_modified: "2025-11-19T09:30:00Z",
          server_modified: "2025-11-19T09:30:11Z",
          rev: "01abcdef89abcdef",
          size: 38421,
          content_hash: "a1b2c344298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852bcde",
          is_downloadable: true,
        },
      ],
    },
  ],
};
