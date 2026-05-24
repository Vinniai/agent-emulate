import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "discord", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "discord",
  tokenPath: "/oauth/token",
  tokenPrefix: "disc",
  connectionConfig: {
    guild_id: "934512889400000000",
  },
  models: [
    {
      model: "Channel",
      collectionPath: "/api/v10/channels",
      idField: "id",
      rows: [
        {
          id: "934512889400000010",
          name: "general",
          type: 0,
          guild_id: "934512889400000000",
          position: 0,
        },
        {
          id: "934512889400000011",
          name: "incident-response",
          type: 0,
          guild_id: "934512889400000000",
          position: 4,
        },
      ],
    },
    {
      model: "Message",
      collectionPath: "/api/v10/channels/CHANNEL/messages",
      idField: "id",
      rows: [
        {
          id: "1199999999999999990",
          channel_id: "934512889400000011",
          type: 0,
          content: "Pager from CloudWatch — RDS CPU > 80% on prod-eu",
          author: {
            id: "200000000000000001",
            username: "ops-bot",
            global_name: "ops-bot",
            discriminator: "0",
            avatar: "a_bab14f271d565501444b2ca3be944b25",
            bot: true,
          },
          timestamp: "2025-12-01T10:14:21.000000+00:00",
          edited_timestamp: null,
          mention_everyone: false,
          pinned: false,
        },
        {
          id: "1199999999999999991",
          channel_id: "934512889400000011",
          type: 0,
          content: "On it, scaling read replicas",
          author: {
            id: "200000000000000002",
            username: "priya",
            global_name: "Priya Anand",
            discriminator: "0",
            avatar: null,
            bot: false,
          },
          timestamp: "2025-12-01T10:15:02.000000+00:00",
          edited_timestamp: null,
          mention_everyone: false,
          pinned: false,
        },
      ],
    },
  ],
};
