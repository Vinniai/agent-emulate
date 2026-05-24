import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "trello", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "trello",
  tokenPath: "/oauth/token",
  tokenPrefix: "trel",
  connectionConfig: {},
  models: [
    {
      model: "Card",
      collectionPath: "/1/cards",
      idField: "id",
      rows: [
        {
          id: "64f0a8e0c0b1d2e3f4a5b6c7",
          idShort: 42,
          name: "Onboarding redesign",
          idBoard: "64a0a8e0c0b1d2e3f4a5b6c0",
          idList: "64a0a8e0c0b1d2e3f4a5b6c1",
          due: "2026-01-10T17:00:00.000Z",
          dueComplete: false,
          closed: false,
          pos: 65535,
          shortLink: "H0TZyzbK",
          shortUrl: "https://trello.com/c/H0TZyzbK",
          url: "https://trello.com/c/H0TZyzbK/42-onboarding-redesign",
          idMembers: ["64bbe4b7ddc1b351efACME001"],
          labels: [
            {
              id: "64ccacb7ddc1b351efLABEL01",
              idBoard: "64a0a8e0c0b1d2e3f4a5b6c0",
              name: "Priority",
              color: "red",
            },
          ],
        },
      ],
    },
    {
      model: "Board",
      collectionPath: "/1/boards",
      idField: "id",
      rows: [
        {
          id: "64a0a8e0c0b1d2e3f4a5b6c0",
          name: "Acme Roadmap",
          desc: "",
          closed: false,
          idOrganization: "64a0a8e0c0b1d2e3f4a5bORG0",
          url: "https://trello.com/b/abc123/acme-roadmap",
          shortUrl: "https://trello.com/b/abc123",
          shortLink: "abc123",
          prefs: {
            permissionLevel: "org",
            backgroundColor: "#0079BF",
          },
        },
      ],
    },
  ],
};
