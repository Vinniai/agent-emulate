import { describe, it, expect } from "vitest";
import { Store } from "@emulators/core";
import { seedFromConfig, getGoogleStore } from "../index.js";

const BASE = "http://localhost:4000";

const SEED = {
  users: [{ email: "user@agent-emulate.dev", name: "Cal User" }],
  calendars: [
    {
      id: "cal_primary",
      user_email: "user@agent-emulate.dev",
      summary: "Primary",
      primary: true,
    },
    {
      id: "cal_team",
      user_email: "user@agent-emulate.dev",
      summary: "Team",
    },
  ],
  calendar_events: [
    {
      id: "evt_standup",
      user_email: "user@agent-emulate.dev",
      calendar_id: "cal_team",
      summary: "Daily standup",
      start_date_time: "2026-05-18T09:00:00Z",
      end_date_time: "2026-05-18T09:15:00Z",
    },
    {
      id: "evt_review",
      user_email: "user@agent-emulate.dev",
      calendar_id: "cal_team",
      summary: "Review",
      start_date_time: "2026-05-18T15:00:00Z",
      end_date_time: "2026-05-18T16:00:00Z",
    },
  ],
};

describe("google seedFromConfig idempotency", () => {
  it("re-seeding the same config does not duplicate calendars or events", () => {
    const store = new Store();
    seedFromConfig(store, BASE, SEED);
    const gs = getGoogleStore(store);
    const counts = {
      calendars: gs.calendars.all().length,
      calendarEvents: gs.calendarEvents.all().length,
    };
    expect(counts.calendars).toBeGreaterThan(0); // guard the test itself
    expect(counts.calendarEvents).toBeGreaterThan(0);

    // Re-run twice — mirrors /_admin/seed merge + apps/server reseedApps.
    seedFromConfig(store, BASE, SEED);
    seedFromConfig(store, BASE, SEED);

    expect({
      calendars: gs.calendars.all().length,
      calendarEvents: gs.calendarEvents.all().length,
    }).toEqual(counts);
  });
});
