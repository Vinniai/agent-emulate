import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "calendly", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = {
  name: "calendly",
  tokenPath: "/oauth/token",
  tokenPrefix: "cale",
  connectionConfig: {
    organization_uri: "https://api.calendly.com/organizations/acme",
  },
  models: [
    {
      model: "ScheduledEvent",
      collectionPath: "/scheduled_events",
      idField: "id",
      rows: [
        {
          uri: "https://api.calendly.com/scheduled_events/EVT_001",
          name: "30 min intro — Priya / Marco",
          status: "active",
          start_time: "2025-12-08T17:00:00.000000Z",
          end_time: "2025-12-08T17:30:00.000000Z",
          event_type: "https://api.calendly.com/event_types/ET_INTRO_30",
          location: {
            type: "zoom",
            status: "pushed",
            join_url: "https://zoom.us/j/123456789",
          },
          invitees_counter: {
            total: 1,
            active: 1,
            limit: 1,
          },
          event_memberships: [
            {
              user: "https://api.calendly.com/users/USR_PRIYA",
              user_email: "priya@agent-emulate.dev",
              user_name: "Priya Anand",
            },
          ],
          event_guests: [],
          created_at: "2025-12-01T09:00:00.000000Z",
          updated_at: "2025-12-01T09:00:00.000000Z",
        },
        {
          uri: "https://api.calendly.com/scheduled_events/EVT_002",
          name: "60 min discovery — Globex",
          status: "active",
          start_time: "2025-12-10T21:00:00.000000Z",
          end_time: "2025-12-10T22:00:00.000000Z",
          event_type: "https://api.calendly.com/event_types/ET_DISCO_60",
          location: {
            type: "google_conference",
            status: "pushed",
            join_url: "https://meet.google.com/abc-defg-hij",
          },
          invitees_counter: {
            total: 1,
            active: 1,
            limit: 1,
          },
          event_memberships: [
            {
              user: "https://api.calendly.com/users/USR_MARCO",
              user_email: "marco@agent-emulate.dev",
              user_name: "Marco Ruiz",
            },
          ],
          event_guests: [],
          created_at: "2025-12-02T14:00:00.000000Z",
          updated_at: "2025-12-02T14:00:00.000000Z",
        },
      ],
    },
  ],
};
