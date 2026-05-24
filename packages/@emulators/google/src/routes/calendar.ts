import type { RouteContext } from "@emulators/core";
import {
  buildFreeBusyResponse,
  createCalendarEventRecord,
  createCalendarRecord,
  deleteCalendarEventRecord,
  formatCalendarEventResource,
  formatCalendarResource,
  getCalendarById,
  getCalendarEventById,
  listCalendarEvents,
  listCalendarsForUser,
  updateCalendarEventRecord,
} from "../calendar-helpers.js";
import { googleApiError } from "../helpers.js";
import {
  getRecord,
  getRecordArray,
  parseCalendarEventInputFromBody,
  parseGoogleBody,
  requireGoogleAuth,
  requireGmailUser,
} from "../route-helpers.js";
import { getGoogleStore } from "../store.js";

export function calendarRoutes({ app, store }: RouteContext): void {
  const gs = getGoogleStore(store);

  // List calendars
  app.get("/calendar/v3/users/:userId/calendarList", (c) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    return c.json({
      kind: "calendar#calendarList",
      items: listCalendarsForUser(gs, authEmail).map((calendar) => formatCalendarResource(calendar)),
    });
  });

  // Get single calendarList entry
  app.get("/calendar/v3/users/:userId/calendarList/:calendarId", (c) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const calendar = getCalendarById(gs, authEmail, c.req.param("calendarId"));
    if (!calendar) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    return c.json(formatCalendarResource(calendar));
  });

  // Get calendar metadata
  app.get("/calendar/v3/calendars/:calendarId", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const calendar = getCalendarById(gs, authEmail, c.req.param("calendarId"));
    if (!calendar) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    return c.json({
      kind: "calendar#calendar",
      etag: `"${calendar.google_id}"`,
      id: calendar.google_id,
      summary: calendar.summary,
      description: calendar.description ?? undefined,
      timeZone: calendar.time_zone,
    });
  });

  // Create calendar
  app.post("/calendar/v3/calendars", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const summary = typeof requestBody.summary === "string" ? requestBody.summary : "New Calendar";

    const calendar = createCalendarRecord(gs, {
      user_email: authEmail,
      summary,
      description: typeof requestBody.description === "string" ? requestBody.description : null,
      time_zone: typeof requestBody.timeZone === "string" ? requestBody.timeZone : "UTC",
    });

    return c.json(
      {
        kind: "calendar#calendar",
        etag: `"${calendar.google_id}"`,
        id: calendar.google_id,
        summary: calendar.summary,
        description: calendar.description ?? undefined,
        timeZone: calendar.time_zone,
      },
      200,
    );
  });

  app.get("/calendar/v3/calendars/:calendarId/events", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const calendar = getCalendarById(gs, authEmail, c.req.param("calendarId"));
    if (!calendar) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const url = new URL(c.req.url);
    const response = listCalendarEvents(gs, authEmail, calendar.google_id, {
      timeMin: url.searchParams.get("timeMin"),
      timeMax: url.searchParams.get("timeMax"),
      maxResults: url.searchParams.get("maxResults"),
      pageToken: url.searchParams.get("pageToken"),
      q: url.searchParams.get("q"),
      orderBy: url.searchParams.get("orderBy"),
    });

    return c.json({
      kind: "calendar#events",
      items: response.items.map((event) => formatCalendarEventResource(gs, event)),
      nextPageToken: response.nextPageToken,
    });
  });

  // Get single event
  app.get("/calendar/v3/calendars/:calendarId/events/:eventId", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const event = getCalendarEventById(gs, authEmail, c.req.param("calendarId"), c.req.param("eventId"));
    if (!event) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    return c.json(formatCalendarEventResource(gs, event));
  });

  app.post("/calendar/v3/calendars/:calendarId/events", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const calendar = getCalendarById(gs, authEmail, c.req.param("calendarId"));
    if (!calendar) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const eventInput = parseCalendarEventInputFromBody(requestBody);

    if (
      (!eventInput.start_date_time && !eventInput.start_date) ||
      (!eventInput.end_date_time && !eventInput.end_date)
    ) {
      return googleApiError(c, 400, "Event start and end are required.", "invalidArgument", "INVALID_ARGUMENT");
    }

    const event = createCalendarEventRecord(gs, {
      user_email: authEmail,
      calendar_google_id: calendar.google_id,
      ...eventInput,
    });

    return c.json(formatCalendarEventResource(gs, event));
  });

  app.patch("/calendar/v3/calendars/:calendarId/events/:eventId", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const event = getCalendarEventById(gs, authEmail, c.req.param("calendarId"), c.req.param("eventId"));
    if (!event) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const eventInput = parseCalendarEventInputFromBody(requestBody);

    const updated = updateCalendarEventRecord(gs, event, eventInput);
    return c.json(formatCalendarEventResource(gs, updated));
  });

  // Also support PUT for full replacement
  app.put("/calendar/v3/calendars/:calendarId/events/:eventId", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const event = getCalendarEventById(gs, authEmail, c.req.param("calendarId"), c.req.param("eventId"));
    if (!event) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const eventInput = parseCalendarEventInputFromBody(requestBody);

    const updated = updateCalendarEventRecord(gs, event, eventInput);
    return c.json(formatCalendarEventResource(gs, updated));
  });

  app.delete("/calendar/v3/calendars/:calendarId/events/:eventId", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const event = getCalendarEventById(gs, authEmail, c.req.param("calendarId"), c.req.param("eventId"));
    if (!event) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    deleteCalendarEventRecord(gs, event);
    return c.body(null, 204);
  });

  app.post("/calendar/v3/freeBusy", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const timeMin = typeof requestBody.timeMin === "string" ? requestBody.timeMin : undefined;
    const timeMax = typeof requestBody.timeMax === "string" ? requestBody.timeMax : undefined;
    const items = getRecordArray(requestBody, "items")
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : "",
      }))
      .filter((entry) => entry.id.length > 0);

    if (!timeMin || !timeMax) {
      return googleApiError(c, 400, "timeMin and timeMax are required.", "invalidArgument", "INVALID_ARGUMENT");
    }

    return c.json(
      buildFreeBusyResponse(gs, authEmail, {
        timeMin,
        timeMax,
        items,
      }),
    );
  });
}
