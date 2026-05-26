import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "hono";
import {
  createLabelRecord,
  createStoredMessage,
  ensureSystemLabels,
  findLabelById,
  findLabelByName,
  generateUid,
} from "./helpers.js";
import { createCalendarEventRecord, createCalendarRecord } from "./calendar-helpers.js";
import { createDriveItemRecord } from "./drive-helpers.js";
import { calendarRoutes } from "./routes/calendar.js";
import { draftRoutes } from "./routes/drafts.js";
import { driveRoutes } from "./routes/drive.js";
import { historyRoutes } from "./routes/history.js";
import { labelRoutes } from "./routes/labels.js";
import { messageRoutes } from "./routes/messages.js";
import { oauthRoutes } from "./routes/oauth.js";
import { settingsRoutes } from "./routes/settings.js";
import { threadRoutes } from "./routes/threads.js";
import { getGoogleStore } from "./store.js";

export { getGoogleStore, type GoogleStore } from "./store.js";
export * from "./entities.js";

export interface GoogleSeedUser {
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  email_verified?: boolean;
  hd?: string;
}

export interface GoogleSeedLabel {
  id?: string;
  user_email?: string;
  name: string;
  type?: "system" | "user";
  message_list_visibility?: string;
  label_list_visibility?: string;
  color_background?: string;
  color_text?: string;
}

export interface GoogleSeedMessage {
  id?: string;
  thread_id?: string;
  user_email?: string;
  raw?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  reply_to?: string;
  subject?: string;
  snippet?: string;
  body_text?: string;
  body_html?: string;
  label_ids?: string[];
  date?: string;
  internal_date?: string;
  message_id?: string;
  references?: string;
  in_reply_to?: string;
}

export interface GoogleSeedCalendar {
  id?: string;
  user_email?: string;
  // `name` is accepted as an alias for `summary` (the field real Google uses),
  // since that is what seed authors commonly write.
  summary?: string;
  name?: string;
  description?: string;
  time_zone?: string;
  primary?: boolean;
  selected?: boolean;
  access_role?: string;
}

export interface GoogleSeedCalendarEvent {
  id?: string;
  user_email?: string;
  calendar_id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  // Internal storage fields. When present these win over the convenience
  // `start`/`end` below.
  start_date_time?: string;
  start_date?: string;
  end_date_time?: string;
  end_date?: string;
  // Convenience shapes seed authors actually write: a flat ISO string
  // ("2026-04-14T07:30:00+11:00" → timed, "2026-04-14" → all-day) or the
  // real Google nested object. Normalized into the fields above on load.
  start?: string | { dateTime?: string; date?: string };
  end?: string | { dateTime?: string; date?: string };
  attendees?: Array<{
    email: string;
    display_name?: string;
  }>;
  conference_entry_points?: Array<{
    entry_point_type: string;
    uri: string;
    label?: string;
  }>;
  hangout_link?: string;
}

export interface GoogleSeedDriveItem {
  id?: string;
  user_email?: string;
  name: string;
  mime_type: string;
  parent_ids?: string[];
  // Convenience shapes seed authors actually write: `parent_id` is the singular
  // form of `parent_ids`; `size` overrides the byte length derived from `data`;
  // `modified_time` (alias `modified_date_time`) sets the reported modifiedTime
  // instead of the insertion timestamp.
  parent_id?: string;
  size?: number;
  modified_time?: string;
  modified_date_time?: string;
  data?: string;
}

export interface GoogleSeedConfig {
  port?: number;
  users?: GoogleSeedUser[];
  oauth_clients?: Array<{
    client_id: string;
    client_secret: string;
    name?: string;
    redirect_uris: string[];
  }>;
  labels?: GoogleSeedLabel[];
  messages?: GoogleSeedMessage[];
  calendars?: GoogleSeedCalendar[];
  calendar_events?: GoogleSeedCalendarEvent[];
  drive_items?: GoogleSeedDriveItem[];
}

function seedDefaults(store: Store, _baseUrl: string): void {
  const gs = getGoogleStore(store);
  const defaultEmail = "testuser@gmail.com";

  if (!gs.users.findOneBy("email", defaultEmail)) {
    gs.users.insert({
      uid: generateUid("goog"),
      email: defaultEmail,
      name: "Test User",
      given_name: "Test",
      family_name: "User",
      picture: null,
      email_verified: true,
      locale: "en",
      hd: null,
    });
  }

  ensureSystemLabels(gs, defaultEmail);
  seedCalendars(
    store,
    [
      {
        id: "primary",
        user_email: defaultEmail,
        summary: defaultEmail,
        primary: true,
        selected: true,
        time_zone: "UTC",
      },
      {
        id: "cal_team",
        user_email: defaultEmail,
        summary: "Team Calendar",
        description: "Shared team events",
        selected: true,
        time_zone: "UTC",
      },
    ],
    defaultEmail,
  );
  seedCalendarEvents(
    store,
    [
      {
        id: "evt_standup",
        user_email: defaultEmail,
        calendar_id: "primary",
        summary: "Daily Standup",
        description: "Team sync",
        start_date_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        end_date_time: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        attendees: [
          { email: defaultEmail, display_name: "Test User" },
          { email: "teammate@agent-emulate.dev", display_name: "Teammate" },
        ],
        conference_entry_points: [
          {
            entry_point_type: "video",
            uri: "https://meet.google.com/emulate-standup",
            label: "Google Meet",
          },
        ],
        hangout_link: "https://meet.google.com/emulate-standup",
      },
    ],
    defaultEmail,
  );
  seedDriveItems(
    store,
    [
      {
        id: "drv_root_receipts",
        user_email: defaultEmail,
        name: "Receipts",
        mime_type: "application/vnd.google-apps.folder",
        parent_ids: ["root"],
      },
      {
        id: "drv_receipt_pdf",
        user_email: defaultEmail,
        name: "March Receipt.pdf",
        mime_type: "application/pdf",
        parent_ids: ["drv_root_receipts"],
        data: "receipt-pdf-data",
      },
    ],
    defaultEmail,
  );
  seedMessages(
    store,
    [
      {
        id: "msg_welcome",
        thread_id: "thr_welcome",
        user_email: defaultEmail,
        from: "Welcome Team <welcome@agent-emulate.dev>",
        to: defaultEmail,
        subject: "Welcome to your local Gmail emulator",
        snippet: "Your OAuth flow is set up and Gmail message, thread, and label APIs are ready.",
        body_text:
          "Your OAuth flow is set up and Gmail message, thread, and label APIs are ready.\n\nUse this inbox to test Gmail automations locally.",
        label_ids: ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
        date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      {
        id: "msg_build",
        thread_id: "thr_build",
        user_email: defaultEmail,
        from: "Build Bot <builds@agent-emulate.dev>",
        to: defaultEmail,
        subject: "Nightly build finished successfully",
        snippet: "The latest build completed successfully in 6 minutes.",
        body_text:
          "The latest build completed successfully in 6 minutes.\n\nArtifact upload finished and smoke checks passed.",
        label_ids: ["INBOX", "CATEGORY_UPDATES"],
        date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "msg_build_reply",
        thread_id: "thr_build",
        user_email: defaultEmail,
        from: defaultEmail,
        to: "Build Bot <builds@agent-emulate.dev>",
        subject: "Re: Nightly build finished successfully",
        snippet: "Thanks, I will review the artifact after lunch.",
        body_text: "Thanks, I will review the artifact after lunch.",
        label_ids: ["SENT"],
        date: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        in_reply_to: "<msg_build@emulate.google.local>",
        references: "<msg_build@emulate.google.local>",
      },
      {
        id: "msg_draft",
        thread_id: "thr_draft",
        user_email: defaultEmail,
        from: defaultEmail,
        to: "someone@agent-emulate.dev",
        subject: "Draft follow-up",
        snippet: "Checking in on the open question from yesterday.",
        body_text: "Checking in on the open question from yesterday.",
        label_ids: ["DRAFT"],
        date: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ],
    defaultEmail,
  );
}

const CONSUMER_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

function deriveHd(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (CONSUMER_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

function resolveHd(user: GoogleSeedUser): string | null {
  if (user.hd !== undefined) return user.hd || null;
  return deriveHd(user.email);
}

export function seedFromConfig(store: Store, _baseUrl: string, config: GoogleSeedConfig): void {
  const gs = getGoogleStore(store);

  if (config.users) {
    for (const user of config.users) {
      const existing = gs.users.findOneBy("email", user.email);
      if (!existing) {
        const nameParts = (user.name ?? "").split(/\s+/).filter(Boolean);
        gs.users.insert({
          uid: generateUid("goog"),
          email: user.email,
          name: user.name ?? user.email.split("@")[0],
          given_name: user.given_name ?? nameParts[0] ?? "",
          family_name: user.family_name ?? nameParts.slice(1).join(" "),
          picture: user.picture ?? null,
          email_verified: user.email_verified ?? true,
          locale: user.locale ?? "en",
          hd: resolveHd(user),
        });
      }

      ensureSystemLabels(gs, user.email);
    }
  }

  if (config.oauth_clients) {
    for (const client of config.oauth_clients) {
      const existing = gs.oauthClients.findOneBy("client_id", client.client_id);
      if (existing) continue;

      gs.oauthClients.insert({
        client_id: client.client_id,
        client_secret: client.client_secret,
        name: client.name ?? "Code App (Google)",
        redirect_uris: client.redirect_uris,
      });
    }
  }

  const fallbackEmail = config.users?.[0]?.email ?? gs.users.all()[0]?.email ?? "testuser@gmail.com";
  ensureSystemLabels(gs, fallbackEmail);

  if (config.labels) {
    seedLabels(store, config.labels, fallbackEmail);
  }

  if (config.messages) {
    seedMessages(store, config.messages, fallbackEmail);
  }

  if (config.calendars) {
    seedCalendars(store, config.calendars, fallbackEmail);
  }

  if (config.calendar_events) {
    seedCalendarEvents(store, config.calendar_events, fallbackEmail);
  }

  if (config.drive_items) {
    seedDriveItems(store, config.drive_items, fallbackEmail);
  }
}

function seedLabels(store: Store, labels: GoogleSeedLabel[], fallbackEmail: string): void {
  const gs = getGoogleStore(store);

  for (const label of labels) {
    const userEmail = label.user_email ?? fallbackEmail;
    ensureSystemLabels(gs, userEmail);

    const existing =
      (label.id ? findLabelById(gs, userEmail, label.id) : undefined) ?? findLabelByName(gs, userEmail, label.name);

    if (existing) continue;

    createLabelRecord(gs, {
      gmail_id: label.id,
      user_email: userEmail,
      name: label.name,
      type: label.type ?? "user",
      message_list_visibility: label.message_list_visibility ?? "show",
      label_list_visibility: label.label_list_visibility ?? "labelShow",
      color_background: label.color_background ?? null,
      color_text: label.color_text ?? null,
    });
  }
}

function seedMessages(store: Store, messages: GoogleSeedMessage[], fallbackEmail: string): void {
  const gs = getGoogleStore(store);

  for (const message of messages) {
    const userEmail = message.user_email ?? fallbackEmail;
    ensureSystemLabels(gs, userEmail);

    if (message.id && gs.messages.findOneBy("gmail_id", message.id)) continue;

    createStoredMessage(
      gs,
      {
        gmail_id: message.id,
        thread_id: message.thread_id,
        user_email: userEmail,
        raw: message.raw ?? null,
        from: message.from,
        to: message.to,
        cc: message.cc ?? null,
        bcc: message.bcc ?? null,
        reply_to: message.reply_to ?? null,
        subject: message.subject,
        snippet: message.snippet,
        body_text: message.body_text ?? null,
        body_html: message.body_html ?? null,
        label_ids: message.label_ids ?? ["INBOX", "UNREAD"],
        date: message.date,
        internal_date: message.internal_date,
        message_id: message.message_id,
        references: message.references ?? null,
        in_reply_to: message.in_reply_to ?? null,
      },
      {
        createMissingCustomLabels: true,
      },
    );
  }
}

function seedCalendars(store: Store, calendars: GoogleSeedCalendar[], fallbackEmail: string): void {
  const gs = getGoogleStore(store);

  for (const calendar of calendars) {
    const userEmail = calendar.user_email ?? fallbackEmail;
    if (calendar.id && gs.calendars.findBy("google_id", calendar.id).some((c) => c.user_email === userEmail)) {
      continue;
    }
    createCalendarRecord(gs, {
      google_id: calendar.id,
      user_email: userEmail,
      summary: calendar.summary ?? calendar.name ?? "",
      description: calendar.description ?? null,
      time_zone: calendar.time_zone ?? "UTC",
      primary: calendar.primary ?? false,
      selected: calendar.selected ?? true,
      access_role: calendar.access_role ?? "owner",
    });
  }
}

// Accept the date shapes seed authors actually write and resolve them to the
// internal dateTime/date split. Explicit snake_case fields win; otherwise a
// flat string splits on whether it carries a time ("T"), and a nested Google
// object passes through. Mirrors the real Calendar API's start/end union.
function normalizeSeedDate(
  flat: string | { dateTime?: string; date?: string } | undefined,
  explicitDateTime: string | undefined,
  explicitDate: string | undefined,
): { dateTime: string | null; date: string | null } {
  if (explicitDateTime || explicitDate) {
    return { dateTime: explicitDateTime ?? null, date: explicitDate ?? null };
  }
  if (typeof flat === "string") {
    return flat.includes("T") ? { dateTime: flat, date: null } : { dateTime: null, date: flat };
  }
  if (flat && typeof flat === "object") {
    return { dateTime: flat.dateTime ?? null, date: flat.date ?? null };
  }
  return { dateTime: null, date: null };
}

function seedCalendarEvents(store: Store, events: GoogleSeedCalendarEvent[], fallbackEmail: string): void {
  const gs = getGoogleStore(store);

  for (const event of events) {
    const userEmail = event.user_email ?? fallbackEmail;
    if (event.id && gs.calendarEvents.findBy("google_id", event.id).some((e) => e.user_email === userEmail)) {
      continue;
    }
    const start = normalizeSeedDate(event.start, event.start_date_time, event.start_date);
    const end = normalizeSeedDate(event.end, event.end_date_time, event.end_date);
    createCalendarEventRecord(gs, {
      google_id: event.id,
      user_email: userEmail,
      calendar_google_id: event.calendar_id ?? "primary",
      status: event.status ?? "confirmed",
      summary: event.summary,
      description: event.description ?? null,
      location: event.location ?? null,
      start_date_time: start.dateTime,
      start_date: start.date,
      end_date_time: end.dateTime,
      end_date: end.date,
      attendees: (event.attendees ?? []).map((attendee) => ({
        email: attendee.email,
        display_name: attendee.display_name ?? null,
        response_status: null,
        organizer: false,
        self: attendee.email === userEmail,
      })),
      conference_entry_points: (event.conference_entry_points ?? []).map((entry) => ({
        entry_point_type: entry.entry_point_type,
        uri: entry.uri,
        label: entry.label ?? null,
      })),
      hangout_link: event.hangout_link ?? null,
    });
  }
}

function seedDriveItems(store: Store, items: GoogleSeedDriveItem[], fallbackEmail: string): void {
  const gs = getGoogleStore(store);

  for (const item of items) {
    const userEmail = item.user_email ?? fallbackEmail;
    if (item.id && gs.driveItems.findOneBy("google_id", item.id)) continue;

    createDriveItemRecord(gs, {
      google_id: item.id,
      user_email: userEmail,
      name: item.name,
      mime_type: item.mime_type,
      parent_google_ids: item.parent_ids ?? (item.parent_id ? [item.parent_id] : ["root"]),
      size: item.size ?? (item.data ? Buffer.byteLength(item.data, "utf8") : null),
      modified_time: item.modified_time ?? item.modified_date_time ?? null,
      data: item.data ? Buffer.from(item.data, "utf8").toString("base64url") : null,
    });
  }
}

/**
 * Project live Google state back into the `GoogleSeedConfig` shape. Round-trips
 * through `seedFromConfig`. System Gmail labels are skipped (they are
 * auto-recreated by `ensureSystemLabels`); only user labels are exported. Drive
 * `data` is stored base64url-encoded and decoded back to the UTF-8 string
 * `seedFromConfig` expects. `oauth_clients.client_secret` is retained — it is
 * static config required to replay the OAuth flow, not an issued credential.
 */
export function storeToSeedConfig(store: Store, _baseUrl: string): GoogleSeedConfig {
  const gs = getGoogleStore(store);
  const undef = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

  const config: GoogleSeedConfig = {
    users: gs.users.all().map((u) => ({
      email: u.email,
      name: u.name,
      given_name: u.given_name,
      family_name: u.family_name,
      picture: undef(u.picture),
      locale: u.locale,
      email_verified: u.email_verified,
      hd: undef(u.hd),
    })),
    oauth_clients: gs.oauthClients.all().map((c) => ({
      client_id: c.client_id,
      client_secret: c.client_secret,
      name: c.name,
      redirect_uris: c.redirect_uris,
    })),
    labels: gs.labels
      .all()
      .filter((l) => l.type === "user")
      .map((l) => ({
        id: l.gmail_id,
        user_email: l.user_email,
        name: l.name,
        message_list_visibility: undef(l.message_list_visibility),
        label_list_visibility: undef(l.label_list_visibility),
        color_background: undef(l.color_background),
        color_text: undef(l.color_text),
      })),
    messages: gs.messages.all().map((m) => ({
      id: m.gmail_id,
      thread_id: m.thread_id,
      user_email: m.user_email,
      from: m.from,
      to: m.to,
      cc: undef(m.cc),
      bcc: undef(m.bcc),
      reply_to: undef(m.reply_to),
      subject: m.subject,
      snippet: m.snippet,
      body_text: undef(m.body_text),
      body_html: undef(m.body_html),
      label_ids: m.label_ids,
      date: undef(m.date_header),
      internal_date: m.internal_date,
      message_id: m.message_id,
      references: undef(m.references),
      in_reply_to: undef(m.in_reply_to),
    })),
    calendars: gs.calendars.all().map((c) => ({
      id: c.google_id,
      user_email: c.user_email,
      summary: c.summary,
      description: undef(c.description),
      time_zone: c.time_zone,
      primary: c.primary,
      selected: c.selected,
      access_role: c.access_role,
    })),
    calendar_events: gs.calendarEvents.all().map((e) => ({
      id: e.google_id,
      user_email: e.user_email,
      calendar_id: e.calendar_google_id,
      status: e.status,
      summary: e.summary,
      description: undef(e.description),
      location: undef(e.location),
      start_date_time: undef(e.start_date_time),
      start_date: undef(e.start_date),
      end_date_time: undef(e.end_date_time),
      end_date: undef(e.end_date),
      attendees: e.attendees.map((a) => ({ email: a.email, display_name: undef(a.display_name) })),
      conference_entry_points: e.conference_entry_points.map((p) => ({
        entry_point_type: p.entry_point_type,
        uri: p.uri,
        label: undef(p.label),
      })),
      hangout_link: undef(e.hangout_link),
    })),
    drive_items: gs.driveItems.all().map((d) => ({
      id: d.google_id,
      user_email: d.user_email,
      name: d.name,
      mime_type: d.mime_type,
      parent_ids: d.parent_google_ids,
      size: d.size ?? undefined,
      modified_time: d.modified_time ?? undefined,
      data: d.data === null ? undefined : Buffer.from(d.data, "base64url").toString("utf8"),
    })),
  };

  return config;
}

export const googlePlugin: ServicePlugin = {
  name: "google",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    oauthRoutes(ctx);
    calendarRoutes(ctx);
    driveRoutes(ctx);
    messageRoutes(ctx);
    draftRoutes(ctx);
    historyRoutes(ctx);
    threadRoutes(ctx);
    labelRoutes(ctx);
    settingsRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default googlePlugin;
