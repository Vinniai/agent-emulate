import type { RouteContext } from "@emulators/core";
import { debug } from "@emulators/core";
import { randomBytes } from "crypto";
import type { MicrosoftUser } from "../entities.js";
import { getMicrosoftStore } from "../store.js";

/**
 * Microsoft Graph API emulator routes.
 *
 * Implements minimum viable endpoints for:
 * - Outlook Mail (/v1.0/me/messages, /v1.0/me/mailFolders)
 * - Outlook Calendar (/v1.0/me/calendars, /v1.0/me/events, /v1.0/me/calendarview)
 * - OneDrive (/v1.0/me/drive, /v1.0/me/drive/root/children)
 * - Teams (/v1.0/me/joinedTeams, /v1.0/teams/:id/channels, channel messages, chats)
 * - User Profile (/v1.0/me, /v1.0/users)
 * - Contacts (/v1.0/me/contacts)
 * - Webhooks/Subscriptions (/v1.0/subscriptions)
 *
 * All data is in-memory, seeded from emulate.config.yaml.
 */

// ---- Shared sub-types ----

interface GraphEmailAddress {
  name: string;
  address: string;
}

interface GraphRecipient {
  emailAddress: GraphEmailAddress;
}

interface GraphIdentity {
  id: string;
  displayName: string;
}

interface GraphIdentitySet {
  user?: GraphIdentity;
  application?: GraphIdentity;
}

// ---- Resource interfaces matching Graph API v1.0 shapes ----

interface GraphMailFolder {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
  isHidden: boolean;
}

interface GraphMessage {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  changeKey: string;
  categories: string[];
  receivedDateTime: string;
  sentDateTime: string | null;
  hasAttachments: boolean;
  internetMessageId: string;
  subject: string;
  bodyPreview: string;
  importance: "low" | "normal" | "high";
  parentFolderId: string;
  conversationId: string;
  isDeliveryReceiptRequested: boolean;
  isReadReceiptRequested: boolean;
  isRead: boolean;
  isDraft: boolean;
  webLink: string;
  inferenceClassification: "focused" | "other";
  body: { contentType: "text" | "html"; content: string };
  sender: GraphRecipient;
  from: GraphRecipient;
  toRecipients: GraphRecipient[];
  ccRecipients: GraphRecipient[];
  bccRecipients: GraphRecipient[];
  replyTo: GraphRecipient[];
  flag: { flagStatus: "notFlagged" | "flagged" | "complete" };
}

interface GraphCalendar {
  id: string;
  name: string;
  color: string;
  isDefaultCalendar: boolean;
  canEdit: boolean;
  owner: GraphEmailAddress;
}

interface GraphAttendee {
  emailAddress: GraphEmailAddress;
  type: "required" | "optional" | "resource";
  status: { response: string; time: string };
}

interface GraphEvent {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  changeKey: string;
  categories: string[];
  transactionId: string | null;
  originalStartTimeZone: string;
  originalEndTimeZone: string;
  iCalUId: string;
  reminderMinutesBeforeStart: number;
  isReminderOn: boolean;
  hasAttachments: boolean;
  subject: string;
  bodyPreview: string;
  importance: "low" | "normal" | "high";
  sensitivity: "normal" | "personal" | "private" | "confidential";
  isAllDay: boolean;
  isCancelled: boolean;
  isOrganizer: boolean;
  isDraft: boolean;
  responseRequested: boolean;
  seriesMasterId: string | null;
  showAs: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  type: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  webLink: string;
  onlineMeetingUrl: string | null;
  isOnlineMeeting: boolean;
  onlineMeetingProvider: "unknown" | "teamsForBusiness" | "skypeForBusiness" | "skypeForConsumer";
  body?: { contentType: string; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location: { displayName: string; locationType: string };
  locations: Array<{ displayName: string }>;
  recurrence: null;
  attendees: GraphAttendee[];
  organizer: GraphRecipient;
  responseStatus: { response: string; time: string };
  // Internal field for filtering — not part of Graph API response
  calendarId: string;
}

interface GraphDriveItem {
  id: string;
  name: string;
  description: string;
  size: number;
  eTag: string;
  cTag: string;
  webUrl: string;
  webDavUrl: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  createdBy: GraphIdentitySet;
  lastModifiedBy: GraphIdentitySet;
  fileSystemInfo: { createdDateTime: string; lastModifiedDateTime: string };
  folder?: { childCount: number };
  file?: { mimeType: string; hashes?: { quickXorHash: string } };
  parentReference?: {
    id: string;
    driveId?: string;
    driveType?: string;
    name?: string;
    path: string;
  };
  "@microsoft.graph.downloadUrl"?: string;
}

interface GraphTeam {
  id: string;
  createdDateTime: string;
  displayName: string;
  description: string;
  internalId: string;
  classification: string | null;
  specialization: string;
  visibility: "private" | "public";
  isArchived: boolean;
  tenantId: string;
  webUrl: string;
  memberSettings: {
    allowCreateUpdateChannels: boolean;
    allowDeleteChannels: boolean;
    allowAddRemoveApps: boolean;
    allowCreateUpdateRemoveTabs: boolean;
    allowCreateUpdateRemoveConnectors: boolean;
  };
  guestSettings: {
    allowCreateUpdateChannels: boolean;
    allowDeleteChannels: boolean;
  };
  messagingSettings: {
    allowUserEditMessages: boolean;
    allowUserDeleteMessages: boolean;
    allowOwnerDeleteMessages: boolean;
    allowTeamMentions: boolean;
    allowChannelMentions: boolean;
  };
  funSettings: {
    allowGiphy: boolean;
    giphyContentRating: string;
    allowStickersAndMemes: boolean;
    allowCustomMemes: boolean;
  };
}

interface GraphChannel {
  id: string;
  createdDateTime: string;
  displayName: string;
  description: string;
  email: string;
  tenantId: string;
  webUrl: string;
  membershipType: "standard" | "private" | "shared";
  isArchived: boolean;
  isFavoriteByDefault: boolean | null;
  // Internal — used for emulator filtering, not in real Graph API response
  teamId: string;
}

interface GraphChannelIdentity {
  channelId: string;
  teamId: string;
  teamDisplayName?: string;
}

interface GraphChatMessage {
  id: string;
  etag: string;
  messageType: "message" | "chatEvent" | "typing" | "unknownFutureValue";
  createdDateTime: string;
  lastModifiedDateTime: string;
  lastEditedDateTime: string | null;
  deletedDateTime: string | null;
  subject: string | null;
  summary: string | null;
  importance: "normal" | "high" | "urgent";
  locale: string;
  webUrl: string | null;
  body: { contentType: "text" | "html"; content: string };
  from: {
    user: {
      id: string;
      displayName: string;
      userIdentityType: "aadUser" | "onPremisesAadUser" | "anonymousGuest" | "federatedIdentity";
    };
  } | null;
  channelIdentity?: GraphChannelIdentity;
  chatId?: string;
  replyToId: string | null;
  attachments: unknown[];
  mentions: unknown[];
  reactions: unknown[];
}

interface GraphChat {
  id: string;
  topic: string | null;
  createdDateTime: string;
  lastUpdatedDateTime: string;
  chatType: "oneOnOne" | "group" | "meeting";
  webUrl: string;
  tenantId: string;
  isHiddenForAllMembers: boolean;
  onlineMeetingInfo: null;
  viewpoint: null;
}

interface GraphContact {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  changeKey: string;
  categories: string[];
  parentFolderId: string;
  fileAs: string;
  displayName: string;
  givenName: string;
  initials: string | null;
  middleName: string | null;
  nickName: string | null;
  surname: string;
  title: string | null;
  generation: string | null;
  jobTitle: string | null;
  companyName: string | null;
  department: string | null;
  officeLocation: string | null;
  profession: string | null;
  assistantName: string | null;
  manager: string | null;
  homePhones: string[];
  mobilePhone: string | null;
  businessPhones: string[];
  imAddresses: string[];
  emailAddresses: Array<{ name: string; address: string }>;
  homeAddress: Record<string, string>;
  businessAddress: Record<string, string>;
  otherAddress: Record<string, string>;
  spouseName: string | null;
  personalNotes: string | null;
  children: string[];
  birthday: string | null;
  businessHomePage: string | null;
  yomiCompanyName: string | null;
  yomiGivenName: string | null;
  yomiSurname: string | null;
}

interface GraphTeamMember {
  id: string;
  displayName: string;
  email: string;
  roles: string[];
  userId: string;
  // Internal — used for emulator filtering
  teamId?: string;
  chatId?: string;
}

interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState: string | null;
  createdDateTime: string;
  applicationId: string | null;
  creatorId: string | null;
  latestSupportedTlsVersion: string;
  lifecycleNotificationUrl: string | null;
  encryptionCertificate: string | null;
  encryptionCertificateId: string | null;
  includeResourceData: boolean;
  notificationQueryOptions: string | null;
  notificationUrlAppId: string | null;
}

// ---- In-memory data stores (per-user) ----

const STORE_KEY_FOLDERS = "microsoft.graph.mailFolders";
const STORE_KEY_MESSAGES = "microsoft.graph.messages";
const STORE_KEY_CALENDARS = "microsoft.graph.calendars";
const STORE_KEY_EVENTS = "microsoft.graph.events";
const STORE_KEY_DRIVE_ITEMS = "microsoft.graph.driveItems";
const STORE_KEY_TEAMS = "microsoft.graph.teams";
const STORE_KEY_CHANNELS = "microsoft.graph.channels";
const STORE_KEY_CHANNEL_MESSAGES = "microsoft.graph.channelMessages";
const STORE_KEY_CHATS = "microsoft.graph.chats";
const STORE_KEY_CHAT_MESSAGES = "microsoft.graph.chatMessages";
const STORE_KEY_CONTACTS = "microsoft.graph.contacts";
const STORE_KEY_TEAM_MEMBERS = "microsoft.graph.teamMembers";
const STORE_KEY_SUBSCRIPTIONS = "microsoft.graph.subscriptions";
const STORE_KEY_DRIVE_CONTENT = "microsoft.graph.driveContent";

function getMailFolders(store: RouteContext["store"]): GraphMailFolder[] {
  return store.getData<GraphMailFolder[]>(STORE_KEY_FOLDERS) ?? [];
}

function getMessages(store: RouteContext["store"]): GraphMessage[] {
  return store.getData<GraphMessage[]>(STORE_KEY_MESSAGES) ?? [];
}

function getCalendars(store: RouteContext["store"]): GraphCalendar[] {
  return store.getData<GraphCalendar[]>(STORE_KEY_CALENDARS) ?? [];
}

function getEvents(store: RouteContext["store"]): GraphEvent[] {
  return store.getData<GraphEvent[]>(STORE_KEY_EVENTS) ?? [];
}

function getDriveItems(store: RouteContext["store"]): GraphDriveItem[] {
  return store.getData<GraphDriveItem[]>(STORE_KEY_DRIVE_ITEMS) ?? [];
}

function getTeams(store: RouteContext["store"]): GraphTeam[] {
  return store.getData<GraphTeam[]>(STORE_KEY_TEAMS) ?? [];
}

function getChannels(store: RouteContext["store"]): GraphChannel[] {
  return store.getData<GraphChannel[]>(STORE_KEY_CHANNELS) ?? [];
}

function getChannelMessages(store: RouteContext["store"]): GraphChatMessage[] {
  return store.getData<GraphChatMessage[]>(STORE_KEY_CHANNEL_MESSAGES) ?? [];
}

function getChats(store: RouteContext["store"]): GraphChat[] {
  return store.getData<GraphChat[]>(STORE_KEY_CHATS) ?? [];
}

function getChatMessages(store: RouteContext["store"]): GraphChatMessage[] {
  return store.getData<GraphChatMessage[]>(STORE_KEY_CHAT_MESSAGES) ?? [];
}

function getContacts(store: RouteContext["store"]): GraphContact[] {
  return store.getData<GraphContact[]>(STORE_KEY_CONTACTS) ?? [];
}

function getTeamMembers(store: RouteContext["store"]): GraphTeamMember[] {
  return store.getData<GraphTeamMember[]>(STORE_KEY_TEAM_MEMBERS) ?? [];
}

function getSubscriptions(store: RouteContext["store"]): GraphSubscription[] {
  return store.getData<GraphSubscription[]>(STORE_KEY_SUBSCRIPTIONS) ?? [];
}

function getDriveContent(store: RouteContext["store"]): Record<string, string> {
  return store.getData<Record<string, string>>(STORE_KEY_DRIVE_CONTENT) ?? {};
}

function requireAuth(c: { get: (key: string) => unknown }) {
  const authUser = c.get("authUser") as { login: string; id: number } | undefined;
  if (!authUser) {
    return null;
  }
  return authUser;
}

function graphError(code: string, message: string) {
  return { error: { code, message } };
}

// ---- Builder helpers used by both seed and route handlers ----

function buildMessage(
  partial: Pick<
    GraphMessage,
    | "id"
    | "subject"
    | "bodyPreview"
    | "body"
    | "from"
    | "toRecipients"
    | "receivedDateTime"
    | "isRead"
    | "isDraft"
    | "parentFolderId"
  > &
    Partial<GraphMessage>,
  baseUrl: string,
): GraphMessage {
  return {
    createdDateTime: partial.receivedDateTime,
    lastModifiedDateTime: partial.receivedDateTime,
    changeKey: `changekey-${randomBytes(4).toString("hex")}`,
    categories: [],
    sentDateTime: null,
    hasAttachments: false,
    internetMessageId: `<${randomBytes(8).toString("hex")}@agent-emulate.dev>`,
    importance: "normal",
    conversationId: `conv-${randomBytes(8).toString("hex")}`,
    isDeliveryReceiptRequested: false,
    isReadReceiptRequested: false,
    webLink: `${baseUrl}/mail/message/${partial.id}`,
    inferenceClassification: "focused",
    sender: partial.from,
    ccRecipients: [],
    bccRecipients: [],
    replyTo: [],
    flag: { flagStatus: "notFlagged" },
    ...partial,
  };
}

function buildEvent(
  partial: Pick<GraphEvent, "id" | "subject" | "start" | "end" | "calendarId"> & Partial<GraphEvent>,
  baseUrl: string,
  organizer: GraphRecipient,
): GraphEvent {
  const now = new Date().toISOString();
  return {
    createdDateTime: now,
    lastModifiedDateTime: now,
    changeKey: `changekey-${randomBytes(4).toString("hex")}`,
    categories: [],
    transactionId: null,
    originalStartTimeZone: partial.start.timeZone,
    originalEndTimeZone: partial.end.timeZone,
    iCalUId: `040000008200E00074C5B7101A82E00800000000${randomBytes(8).toString("hex").toUpperCase()}`,
    reminderMinutesBeforeStart: 15,
    isReminderOn: true,
    hasAttachments: false,
    bodyPreview: "",
    importance: "normal",
    sensitivity: "normal",
    isCancelled: false,
    isOrganizer: true,
    isDraft: false,
    responseRequested: true,
    seriesMasterId: null,
    showAs: "busy",
    type: "singleInstance",
    webLink: `${baseUrl}/calendar/event/${partial.id}`,
    onlineMeetingUrl: null,
    isOnlineMeeting: false,
    onlineMeetingProvider: "unknown",
    isAllDay: false,
    location: { displayName: "", locationType: "default" },
    locations: [],
    recurrence: null,
    attendees: [],
    organizer,
    responseStatus: { response: "organizer", time: new Date(0).toISOString() },
    ...partial,
  };
}

function buildDriveItem(
  partial: Pick<GraphDriveItem, "id" | "name" | "size" | "webUrl" | "createdDateTime" | "lastModifiedDateTime"> &
    Partial<GraphDriveItem>,
  owner: GraphIdentity,
): GraphDriveItem {
  return {
    description: "",
    eTag: `"{${randomBytes(8).toString("hex").toUpperCase()},1}"`,
    cTag: `"c:{${randomBytes(8).toString("hex").toUpperCase()},1}"`,
    webDavUrl: partial.webUrl,
    createdBy: { user: owner },
    lastModifiedBy: { user: owner },
    fileSystemInfo: {
      createdDateTime: partial.createdDateTime,
      lastModifiedDateTime: partial.lastModifiedDateTime,
    },
    ...partial,
  };
}

// ---- Config-driven Graph seed types ----

export interface MicrosoftGraphSeedConfig {
  mail_messages?: Array<{
    id?: string;
    subject: string;
    from_name: string;
    from_address: string;
    to_name?: string;
    to_address?: string;
    body_text: string;
    received_date_time?: string;
    is_read?: boolean;
    /** Folder displayName: "Inbox" | "Sent Items" | "Drafts" — defaults to "Inbox" */
    folder?: string;
  }>;
  calendars?: Array<{
    id: string;
    name: string;
    is_default?: boolean;
  }>;
  calendar_events?: Array<{
    id?: string;
    /** Matches a calendar id from calendars list; defaults to first calendar */
    calendar_id?: string;
    subject: string;
    /** ISO datetime string */
    start: string;
    /** ISO datetime string */
    end: string;
    time_zone?: string;
    location?: string;
    body_text?: string;
    is_all_day?: boolean;
    attendees?: Array<{
      name: string;
      address: string;
      type?: "required" | "optional";
    }>;
  }>;
  drive_items?: Array<{
    id?: string;
    name: string;
    size?: number;
    /** When present, item is a file with this MIME type; absent = folder */
    mime_type?: string;
    /** Parent item id; defaults to "root" */
    parent_id?: string;
    modified_date_time?: string;
    created_date_time?: string;
  }>;
  teams?: Array<{
    id?: string;
    display_name: string;
    description?: string;
    channels?: Array<{
      id?: string;
      display_name: string;
      description?: string;
    }>;
  }>;
  contacts?: Array<{
    id?: string;
    display_name: string;
    given_name?: string;
    surname?: string;
    email?: string;
    phone?: string;
    job_title?: string;
    company_name?: string;
  }>;
}

/** Seed Graph data from emulate.config.yaml — overwrites any previously seeded Graph data. */
export function seedGraphFromConfig(
  store: RouteContext["store"],
  baseUrl: string,
  config: MicrosoftGraphSeedConfig,
): void {
  const ms = getMicrosoftStore(store);
  const users = ms.users.all();
  const firstUser = users[0];
  if (!firstUser) return;

  const now = Date.now();
  const DEFAULT_TZ = "Australia/Sydney";

  // ---- Mail folders (always create standard set) ----
  const inboxId = "inbox";
  const sentId = "sentitems";
  const draftsId = "drafts";
  const folderNameToId: Record<string, string> = {
    inbox: inboxId,
    "sent items": sentId,
    sent: sentId,
    drafts: draftsId,
  };

  const messages = (config.mail_messages ?? []).map((m) => {
    const folderKey = (m.folder ?? "Inbox").toLowerCase();
    const parentFolderId = folderNameToId[folderKey] ?? inboxId;
    const toName = m.to_name ?? firstUser.name;
    const toAddress = m.to_address ?? firstUser.email;
    return buildMessage(
      {
        id: m.id ?? `msg-cfg-${randomBytes(6).toString("hex")}`,
        subject: m.subject,
        bodyPreview: m.body_text.slice(0, 255),
        body: { contentType: "text", content: m.body_text },
        from: { emailAddress: { name: m.from_name, address: m.from_address } },
        toRecipients: [{ emailAddress: { name: toName, address: toAddress } }],
        receivedDateTime: m.received_date_time ?? new Date(now).toISOString(),
        isRead: m.is_read ?? false,
        isDraft: false,
        parentFolderId,
      },
      baseUrl,
    );
  });

  const inboxMessages = messages.filter((m) => m.parentFolderId === inboxId);
  const sentMessages = messages.filter((m) => m.parentFolderId === sentId);

  const folders: GraphMailFolder[] = [
    {
      id: inboxId,
      displayName: "Inbox",
      parentFolderId: null,
      childFolderCount: 0,
      totalItemCount: inboxMessages.length,
      unreadItemCount: inboxMessages.filter((m) => !m.isRead).length,
      isHidden: false,
    },
    {
      id: sentId,
      displayName: "Sent Items",
      parentFolderId: null,
      childFolderCount: 0,
      totalItemCount: sentMessages.length,
      unreadItemCount: 0,
      isHidden: false,
    },
    {
      id: draftsId,
      displayName: "Drafts",
      parentFolderId: null,
      childFolderCount: 0,
      totalItemCount: 0,
      unreadItemCount: 0,
      isHidden: false,
    },
  ];

  store.setData(STORE_KEY_FOLDERS, folders);
  store.setData(STORE_KEY_MESSAGES, messages);

  // ---- Calendars ----
  const organizerRecipient: GraphRecipient = {
    emailAddress: { name: firstUser.name, address: firstUser.email },
  };

  const configCalendars = config.calendars ?? [];
  const defaultCalId = configCalendars[0]?.id ?? `cal-main-${randomBytes(4).toString("hex")}`;

  const calendars: GraphCalendar[] = configCalendars.map((cal) => ({
    id: cal.id,
    name: cal.name,
    color: "auto",
    isDefaultCalendar: cal.is_default ?? false,
    canEdit: true,
    owner: { name: firstUser.name, address: firstUser.email },
  }));

  if (calendars.length > 0 && !calendars.some((c) => c.isDefaultCalendar)) {
    calendars[0].isDefaultCalendar = true;
  }

  store.setData(STORE_KEY_CALENDARS, calendars);

  // ---- Calendar events ----
  const makeEvent = (partial: Parameters<typeof buildEvent>[0]) => buildEvent(partial, baseUrl, organizerRecipient);

  const events = (config.calendar_events ?? []).map((e) => {
    const tz = e.time_zone ?? DEFAULT_TZ;
    const startDt = e.start.endsWith("Z") ? e.start.replace("Z", "") : e.start;
    const endDt = e.end.endsWith("Z") ? e.end.replace("Z", "") : e.end;
    return makeEvent({
      id: e.id ?? `evt-cfg-${randomBytes(6).toString("hex")}`,
      subject: e.subject,
      start: { dateTime: startDt, timeZone: tz },
      end: { dateTime: endDt, timeZone: tz },
      calendarId: e.calendar_id ?? defaultCalId,
      isAllDay: e.is_all_day ?? false,
      location: e.location
        ? { displayName: e.location, locationType: "default" }
        : { displayName: "", locationType: "default" },
      body: e.body_text ? { contentType: "text", content: e.body_text } : undefined,
      attendees: (e.attendees ?? []).map((a) => ({
        emailAddress: { name: a.name, address: a.address },
        type: a.type ?? "required",
        status: { response: "none", time: new Date(0).toISOString() },
      })),
    });
  });

  store.setData(STORE_KEY_EVENTS, events);

  // ---- Drive items ----
  const ownerIdentity: GraphIdentity = {
    id: firstUser.oid,
    displayName: firstUser.name,
  };
  const makeDriveItem = (partial: Parameters<typeof buildDriveItem>[0]) => buildDriveItem(partial, ownerIdentity);

  const driveItems = (config.drive_items ?? []).map((item) => {
    const itemId = item.id ?? `drv-cfg-${randomBytes(6).toString("hex")}`;
    const createdDt = item.created_date_time ?? new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const modifiedDt = item.modified_date_time ?? new Date(now).toISOString();
    const parentId = item.parent_id ?? "root";
    const parentPath = parentId === "root" ? "/drive/root:" : `/drive/root:/parent`;

    return makeDriveItem({
      id: itemId,
      name: item.name,
      size: item.size ?? 0,
      webUrl: `${baseUrl}/drive/${item.name}`,
      createdDateTime: createdDt,
      lastModifiedDateTime: modifiedDt,
      parentReference: {
        id: parentId,
        driveType: "business",
        path: parentPath,
      },
      ...(item.mime_type
        ? {
            file: {
              mimeType: item.mime_type,
              hashes: { quickXorHash: randomBytes(20).toString("base64") },
            },
            "@microsoft.graph.downloadUrl": `${baseUrl}/drive/items/${itemId}/content`,
          }
        : { folder: { childCount: 0 } }),
    });
  });

  store.setData(STORE_KEY_DRIVE_ITEMS, driveItems);

  // ---- Teams & Channels ----
  const TENANT_ID = "common";
  const defaultTeamSettings = {
    memberSettings: {
      allowCreateUpdateChannels: true,
      allowDeleteChannels: false,
      allowAddRemoveApps: true,
      allowCreateUpdateRemoveTabs: true,
      allowCreateUpdateRemoveConnectors: true,
    },
    guestSettings: {
      allowCreateUpdateChannels: false,
      allowDeleteChannels: false,
    },
    messagingSettings: {
      allowUserEditMessages: true,
      allowUserDeleteMessages: true,
      allowOwnerDeleteMessages: true,
      allowTeamMentions: true,
      allowChannelMentions: true,
    },
    funSettings: {
      allowGiphy: true,
      giphyContentRating: "moderate",
      allowStickersAndMemes: true,
      allowCustomMemes: true,
    },
  };

  const teams: GraphTeam[] = (config.teams ?? []).map((t) => {
    const teamId = t.id ?? `team-cfg-${randomBytes(6).toString("hex")}`;
    return {
      id: teamId,
      createdDateTime: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
      displayName: t.display_name,
      description: t.description ?? "",
      internalId: randomBytes(8).toString("hex"),
      classification: null,
      specialization: "none",
      visibility: "private" as const,
      isArchived: false,
      tenantId: TENANT_ID,
      webUrl: `${baseUrl}/teams/${teamId}`,
      ...defaultTeamSettings,
    };
  });
  store.setData(STORE_KEY_TEAMS, teams);

  const channels: GraphChannel[] = [];
  for (let ti = 0; ti < (config.teams ?? []).length; ti++) {
    const teamCfg = config.teams![ti];
    const teamId = teams[ti].id;
    for (const ch of teamCfg.channels ?? []) {
      const channelId = ch.id ?? `19:${randomBytes(8).toString("hex")}@thread.tacv2`;
      channels.push({
        id: channelId,
        createdDateTime: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
        displayName: ch.display_name,
        description: ch.description ?? "",
        email: "",
        tenantId: TENANT_ID,
        webUrl: `${baseUrl}/teams/${teamId}/channels/${channelId}`,
        membershipType: "standard",
        isArchived: false,
        isFavoriteByDefault: null,
        teamId,
      });
    }
  }
  store.setData(STORE_KEY_CHANNELS, channels);

  // ---- Contacts ----
  const contacts: GraphContact[] = (config.contacts ?? []).map((c) => {
    const given = c.given_name ?? c.display_name.split(" ")[0] ?? "";
    const sur = c.surname ?? c.display_name.split(" ").slice(1).join(" ") ?? "";
    return {
      id: c.id ?? `contact-cfg-${randomBytes(6).toString("hex")}`,
      createdDateTime: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
      lastModifiedDateTime: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
      changeKey: `changekey-${randomBytes(4).toString("hex")}`,
      categories: [],
      parentFolderId: "contacts",
      fileAs: `${sur}, ${given}`,
      displayName: c.display_name,
      givenName: given,
      initials: null,
      middleName: null,
      nickName: null,
      surname: sur,
      title: null,
      generation: null,
      jobTitle: c.job_title ?? null,
      companyName: c.company_name ?? null,
      department: null,
      officeLocation: null,
      profession: null,
      assistantName: null,
      manager: null,
      homePhones: [],
      mobilePhone: null,
      businessPhones: c.phone ? [c.phone] : [],
      imAddresses: [],
      emailAddresses: c.email ? [{ name: c.display_name, address: c.email }] : [],
      homeAddress: {},
      businessAddress: {},
      otherAddress: {},
      spouseName: null,
      personalNotes: null,
      children: [],
      birthday: null,
      businessHomePage: null,
      yomiCompanyName: null,
      yomiGivenName: null,
      yomiSurname: null,
    };
  });
  store.setData(STORE_KEY_CONTACTS, contacts);

  // Seed first user as team owner, chats/channel messages empty
  const teamMembers: GraphTeamMember[] = teams.map((team) => ({
    id: `member-cfg-${randomBytes(6).toString("hex")}`,
    displayName: firstUser.name,
    email: firstUser.email,
    roles: ["owner"],
    userId: firstUser.oid,
    teamId: team.id,
  }));
  store.setData(STORE_KEY_TEAM_MEMBERS, teamMembers);
  store.setData(STORE_KEY_CHANNEL_MESSAGES, []);
  store.setData(STORE_KEY_CHATS, []);
  store.setData(STORE_KEY_CHAT_MESSAGES, []);
  store.setData(STORE_KEY_SUBSCRIPTIONS, []);

  debug(
    "microsoft.graph",
    `[Graph config seed] ${folders.length} folders, ${messages.length} messages, ${calendars.length} calendars, ${events.length} events, ${driveItems.length} drive items, ${teams.length} teams, ${channels.length} channels, ${contacts.length} contacts`,
  );
}

/**
 * Reverse of `seedGraphFromConfig`: project the live Graph store (mail,
 * calendars, events, drive items, teams/channels, contacts) back into the
 * `MicrosoftGraphSeedConfig` shape so the export round-trips through
 * `seedGraphFromConfig` verbatim. Only non-empty sections are emitted. Internal
 * Graph wrappers (changeKey, eTag, webLink, …) are dropped; ids are preserved
 * so relationships (event→calendar, channel→team) survive a re-seed.
 */
export function storeToGraphSeedConfig(store: RouteContext["store"]): MicrosoftGraphSeedConfig {
  const out: MicrosoftGraphSeedConfig = {};
  const orUndef = (s: string | null | undefined): string | undefined => (s ? s : undefined);

  const folderIdToName = new Map(getMailFolders(store).map((f) => [f.id, f.displayName]));
  const messages = getMessages(store);
  if (messages.length)
    out.mail_messages = messages.map((m) => ({
      id: m.id,
      subject: m.subject,
      from_name: m.from.emailAddress.name,
      from_address: m.from.emailAddress.address,
      to_name: m.toRecipients[0]?.emailAddress.name,
      to_address: m.toRecipients[0]?.emailAddress.address,
      body_text: m.body.content,
      received_date_time: m.receivedDateTime,
      is_read: m.isRead,
      folder: folderIdToName.get(m.parentFolderId) ?? "Inbox",
    }));

  const calendars = getCalendars(store);
  if (calendars.length)
    out.calendars = calendars.map((c) => ({ id: c.id, name: c.name, is_default: c.isDefaultCalendar }));

  const events = getEvents(store);
  if (events.length)
    out.calendar_events = events.map((e) => ({
      id: e.id,
      calendar_id: e.calendarId,
      subject: e.subject,
      start: e.start.dateTime,
      end: e.end.dateTime,
      time_zone: e.start.timeZone,
      location: orUndef(e.location?.displayName),
      body_text: orUndef(e.body?.content),
      is_all_day: e.isAllDay,
      attendees: e.attendees.map((a) => ({
        name: a.emailAddress.name,
        address: a.emailAddress.address,
        type: a.type === "resource" ? "required" : a.type,
      })),
    }));

  const driveItems = getDriveItems(store);
  if (driveItems.length)
    out.drive_items = driveItems.map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      mime_type: d.file?.mimeType,
      parent_id: d.parentReference?.id ?? "root",
      modified_date_time: d.lastModifiedDateTime,
      created_date_time: d.createdDateTime,
    }));

  const teams = getTeams(store);
  if (teams.length) {
    const channels = getChannels(store);
    out.teams = teams.map((t) => {
      const teamChannels = channels.filter((ch) => ch.teamId === t.id);
      return {
        id: t.id,
        display_name: t.displayName,
        description: orUndef(t.description),
        ...(teamChannels.length
          ? {
              channels: teamChannels.map((ch) => ({
                id: ch.id,
                display_name: ch.displayName,
                description: orUndef(ch.description),
              })),
            }
          : {}),
      };
    });
  }

  const contacts = getContacts(store);
  if (contacts.length)
    out.contacts = contacts.map((c) => ({
      id: c.id,
      display_name: c.displayName,
      given_name: orUndef(c.givenName),
      surname: orUndef(c.surname),
      email: c.emailAddresses[0]?.address,
      phone: c.businessPhones[0],
      job_title: orUndef(c.jobTitle),
      company_name: orUndef(c.companyName),
    }));

  return out;
}

export function seedGraphDefaults(store: RouteContext["store"], baseUrl: string): void {
  const ms = getMicrosoftStore(store);
  const users = ms.users.all();
  const firstUser = users[0];
  if (!firstUser) return;

  // Seed mail folders
  const inboxId = `inbox-${randomBytes(4).toString("hex")}`;
  const sentId = `sent-${randomBytes(4).toString("hex")}`;
  const draftsId = `drafts-${randomBytes(4).toString("hex")}`;

  const folders: GraphMailFolder[] = [
    {
      id: inboxId,
      displayName: "Inbox",
      parentFolderId: null,
      childFolderCount: 0,
      totalItemCount: 3,
      unreadItemCount: 1,
      isHidden: false,
    },
    {
      id: sentId,
      displayName: "Sent Items",
      parentFolderId: null,
      childFolderCount: 0,
      totalItemCount: 1,
      unreadItemCount: 0,
      isHidden: false,
    },
    {
      id: draftsId,
      displayName: "Drafts",
      parentFolderId: null,
      childFolderCount: 0,
      totalItemCount: 0,
      unreadItemCount: 0,
      isHidden: false,
    },
  ];
  store.setData(STORE_KEY_FOLDERS, folders);

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const TENANT_ID = "common";

  // Helper aliases bound to current baseUrl/user
  const makeMessage = (partial: Parameters<typeof buildMessage>[0]) => buildMessage(partial, baseUrl);

  // Seed messages
  const messages: GraphMessage[] = [
    makeMessage({
      id: `msg-${randomBytes(6).toString("hex")}`,
      subject: "Weekly Compliance Report",
      bodyPreview: "Please review the attached compliance report for this week.",
      body: {
        contentType: "text",
        content: "Please review the attached compliance report for this week. All inspections are up to date.",
      },
      from: { emailAddress: { name: "Compliance Team", address: "compliance@agent-emulate.dev" } },
      toRecipients: [{ emailAddress: { name: firstUser.name, address: firstUser.email } }],
      receivedDateTime: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      isRead: false,
      isDraft: false,
      parentFolderId: inboxId,
    }),
    makeMessage({
      id: `msg-${randomBytes(6).toString("hex")}`,
      subject: "Invoice #4521 Approved",
      bodyPreview: "Invoice #4521 for Westfield Tower has been approved.",
      body: {
        contentType: "text",
        content: "Invoice #4521 for Westfield Tower maintenance has been approved and is ready for payment.",
      },
      from: { emailAddress: { name: "Billing System", address: "billing@agent-emulate.dev" } },
      toRecipients: [{ emailAddress: { name: firstUser.name, address: firstUser.email } }],
      receivedDateTime: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      isRead: true,
      isDraft: false,
      parentFolderId: inboxId,
    }),
    makeMessage({
      id: `msg-${randomBytes(6).toString("hex")}`,
      subject: "Site Visit Confirmation - CBD Tower",
      bodyPreview: "Confirming the site visit for CBD Tower on Thursday.",
      body: {
        contentType: "text",
        content:
          "Hi team, just confirming the site visit for CBD Tower is scheduled for Thursday at 9 AM. Please bring all inspection equipment.",
      },
      from: { emailAddress: { name: "Site Manager", address: "sites@agent-emulate.dev" } },
      toRecipients: [{ emailAddress: { name: firstUser.name, address: firstUser.email } }],
      receivedDateTime: new Date(now - 3 * DAY).toISOString(),
      isRead: true,
      isDraft: false,
      parentFolderId: inboxId,
    }),
  ];
  store.setData(STORE_KEY_MESSAGES, messages);

  // Seed calendars
  const mainCalId = `cal-main-${randomBytes(4).toString("hex")}`;
  const calendars: GraphCalendar[] = [
    {
      id: mainCalId,
      name: "Calendar",
      color: "auto",
      isDefaultCalendar: true,
      canEdit: true,
      owner: { name: firstUser.name, address: firstUser.email },
    },
  ];
  store.setData(STORE_KEY_CALENDARS, calendars);

  const organizerRecipient: GraphRecipient = { emailAddress: { name: firstUser.name, address: firstUser.email } };
  const makeEvent = (partial: Parameters<typeof buildEvent>[0]) => buildEvent(partial, baseUrl, organizerRecipient);

  const events: GraphEvent[] = [
    makeEvent({
      id: `evt-${randomBytes(6).toString("hex")}`,
      subject: "Fire Panel Inspection - Westfield Tower",
      start: { dateTime: new Date(now + 1 * DAY).toISOString().replace("Z", ""), timeZone: "Australia/Sydney" },
      end: {
        dateTime: new Date(now + 1 * DAY + 2 * 60 * 60 * 1000).toISOString().replace("Z", ""),
        timeZone: "Australia/Sydney",
      },
      location: { displayName: "Westfield Tower, Level 3", locationType: "default" },
      calendarId: mainCalId,
      attendees: [
        {
          emailAddress: { name: "Site Manager", address: "sites@agent-emulate.dev" },
          type: "required",
          status: { response: "accepted", time: new Date(0).toISOString() },
        },
      ],
    }),
    makeEvent({
      id: `evt-${randomBytes(6).toString("hex")}`,
      subject: "Team Standup",
      start: { dateTime: new Date(now + 2 * DAY).toISOString().replace("Z", ""), timeZone: "Australia/Sydney" },
      end: {
        dateTime: new Date(now + 2 * DAY + 30 * 60 * 1000).toISOString().replace("Z", ""),
        timeZone: "Australia/Sydney",
      },
      showAs: "free",
      calendarId: mainCalId,
    }),
    makeEvent({
      id: `evt-${randomBytes(6).toString("hex")}`,
      subject: "Quarterly Compliance Review",
      start: { dateTime: new Date(now + 5 * DAY).toISOString().replace("Z", ""), timeZone: "Australia/Sydney" },
      end: {
        dateTime: new Date(now + 5 * DAY + 3 * 60 * 60 * 1000).toISOString().replace("Z", ""),
        timeZone: "Australia/Sydney",
      },
      location: { displayName: "Head Office, Board Room", locationType: "default" },
      calendarId: mainCalId,
    }),
  ];
  store.setData(STORE_KEY_EVENTS, events);

  const ownerIdentity: GraphIdentity = { id: firstUser.oid, displayName: firstUser.name };
  const makeDriveItem = (partial: Parameters<typeof buildDriveItem>[0]) => buildDriveItem(partial, ownerIdentity);

  // Seed drive items
  const rootId = "root";
  const driveItems: GraphDriveItem[] = [
    makeDriveItem({
      id: "folder-inspections",
      name: "Inspections",
      size: 0,
      webUrl: `${baseUrl}/drive/Inspections`,
      folder: { childCount: 2 },
      createdDateTime: new Date(now - 30 * DAY).toISOString(),
      lastModifiedDateTime: new Date(now - 7 * DAY).toISOString(),
      parentReference: { id: rootId, driveType: "business", path: "/drive/root:" },
    }),
    makeDriveItem({
      id: "folder-contracts",
      name: "Contracts",
      size: 0,
      webUrl: `${baseUrl}/drive/Contracts`,
      folder: { childCount: 1 },
      createdDateTime: new Date(now - 60 * DAY).toISOString(),
      lastModifiedDateTime: new Date(now - 14 * DAY).toISOString(),
      parentReference: { id: rootId, driveType: "business", path: "/drive/root:" },
    }),
    makeDriveItem({
      id: "file-report-1",
      name: "Q1-2026-Compliance-Report.pdf",
      size: 245000,
      webUrl: `${baseUrl}/drive/Q1-2026-Compliance-Report.pdf`,
      file: { mimeType: "application/pdf", hashes: { quickXorHash: randomBytes(20).toString("base64") } },
      createdDateTime: new Date(now - 10 * DAY).toISOString(),
      lastModifiedDateTime: new Date(now - 3 * DAY).toISOString(),
      parentReference: {
        id: "folder-inspections",
        driveType: "business",
        name: "Inspections",
        path: "/drive/root:/Inspections",
      },
      "@microsoft.graph.downloadUrl": `${baseUrl}/drive/items/file-report-1/content`,
    }),
  ];
  store.setData(STORE_KEY_DRIVE_ITEMS, driveItems);

  const defaultTeamSettings = {
    memberSettings: {
      allowCreateUpdateChannels: true,
      allowDeleteChannels: false,
      allowAddRemoveApps: true,
      allowCreateUpdateRemoveTabs: true,
      allowCreateUpdateRemoveConnectors: true,
    },
    guestSettings: { allowCreateUpdateChannels: false, allowDeleteChannels: false },
    messagingSettings: {
      allowUserEditMessages: true,
      allowUserDeleteMessages: true,
      allowOwnerDeleteMessages: true,
      allowTeamMentions: true,
      allowChannelMentions: true,
    },
    funSettings: {
      allowGiphy: true,
      giphyContentRating: "moderate",
      allowStickersAndMemes: true,
      allowCustomMemes: true,
    },
  };

  // Seed Teams
  const teamId = `team-${randomBytes(6).toString("hex")}`;
  const teams: GraphTeam[] = [
    {
      id: teamId,
      createdDateTime: new Date(now - 90 * DAY).toISOString(),
      displayName: "Fireguard Operations",
      description: "Main operations team for inspections and compliance",
      internalId: randomBytes(8).toString("hex"),
      classification: null,
      specialization: "none",
      visibility: "private",
      isArchived: false,
      tenantId: TENANT_ID,
      webUrl: `${baseUrl}/teams/${teamId}`,
      ...defaultTeamSettings,
    },
  ];
  store.setData(STORE_KEY_TEAMS, teams);

  // Seed Channels
  const generalChannelId = `19:${randomBytes(8).toString("hex")}@thread.tacv2`;
  const complianceChannelId = `19:${randomBytes(8).toString("hex")}@thread.tacv2`;
  const channels: GraphChannel[] = [
    {
      id: generalChannelId,
      createdDateTime: new Date(now - 90 * DAY).toISOString(),
      displayName: "General",
      description: "General discussion channel",
      email: "",
      tenantId: TENANT_ID,
      webUrl: `${baseUrl}/teams/${teamId}/channels/${generalChannelId}`,
      membershipType: "standard",
      isArchived: false,
      isFavoriteByDefault: null,
      teamId,
    },
    {
      id: complianceChannelId,
      createdDateTime: new Date(now - 60 * DAY).toISOString(),
      displayName: "Compliance",
      description: "Compliance reports and inspections",
      email: "",
      tenantId: TENANT_ID,
      webUrl: `${baseUrl}/teams/${teamId}/channels/${complianceChannelId}`,
      membershipType: "standard",
      isArchived: false,
      isFavoriteByDefault: null,
      teamId,
    },
  ];
  store.setData(STORE_KEY_CHANNELS, channels);

  // Helper to build a full chat message
  const makeChannelMessage = (
    partial: Pick<GraphChatMessage, "id" | "body" | "from" | "importance"> & {
      channelId: string;
      teamId: string;
      subject?: string | null;
    },
  ): GraphChatMessage => ({
    etag: partial.id,
    messageType: "message",
    createdDateTime: new Date(Number(partial.id)).toISOString(),
    lastModifiedDateTime: new Date(Number(partial.id)).toISOString(),
    lastEditedDateTime: null,
    deletedDateTime: null,
    subject: partial.subject ?? null,
    summary: null,
    locale: "en-AU",
    webUrl: `${baseUrl}/teams/${partial.teamId}/channels/${partial.channelId}/messages/${partial.id}`,
    replyToId: null,
    attachments: [],
    mentions: [],
    reactions: [],
    channelIdentity: { channelId: partial.channelId, teamId: partial.teamId },
    ...partial,
  });

  // Seed Channel Messages
  const channelMessages: GraphChatMessage[] = [
    makeChannelMessage({
      id: String(now - 3 * DAY),
      importance: "normal",
      body: { contentType: "html", content: "<p>Welcome to the team! Please introduce yourselves here.</p>" },
      from: { user: { id: firstUser.oid, displayName: firstUser.name, userIdentityType: "aadUser" } },
      channelId: generalChannelId,
      teamId,
    }),
    makeChannelMessage({
      id: String(now - 1 * DAY),
      subject: "Weekly Compliance Review",
      importance: "high",
      body: { contentType: "html", content: "<p>Reminder: Weekly compliance review meeting tomorrow at 10 AM.</p>" },
      from: { user: { id: firstUser.oid, displayName: firstUser.name, userIdentityType: "aadUser" } },
      channelId: complianceChannelId,
      teamId,
    }),
  ];
  store.setData(STORE_KEY_CHANNEL_MESSAGES, channelMessages);

  // Seed Chats (1:1 and group)
  const oneOnOneChatId = `19:${randomBytes(8).toString("hex")}_${randomBytes(8).toString("hex")}@unq.gbl.spaces`;
  const groupChatId = `19:${randomBytes(16).toString("hex")}@thread.v2`;
  const chats: GraphChat[] = [
    {
      id: oneOnOneChatId,
      topic: null,
      createdDateTime: new Date(now - 7 * DAY).toISOString(),
      lastUpdatedDateTime: new Date(now - 30 * 60 * 1000).toISOString(),
      chatType: "oneOnOne",
      webUrl: `${baseUrl}/chats/${oneOnOneChatId}`,
      tenantId: TENANT_ID,
      isHiddenForAllMembers: false,
      onlineMeetingInfo: null,
      viewpoint: null,
    },
    {
      id: groupChatId,
      topic: "Westfield Tower Inspection",
      createdDateTime: new Date(now - 14 * DAY).toISOString(),
      lastUpdatedDateTime: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      chatType: "group",
      webUrl: `${baseUrl}/chats/${groupChatId}`,
      tenantId: TENANT_ID,
      isHiddenForAllMembers: false,
      onlineMeetingInfo: null,
      viewpoint: null,
    },
  ];
  store.setData(STORE_KEY_CHATS, chats);

  // Helper for chat messages
  const makeChatMessage = (
    partial: Pick<GraphChatMessage, "id" | "body" | "from" | "importance" | "chatId">,
  ): GraphChatMessage => ({
    etag: partial.id,
    messageType: "message",
    createdDateTime: new Date(Number(partial.id)).toISOString(),
    lastModifiedDateTime: new Date(Number(partial.id)).toISOString(),
    lastEditedDateTime: null,
    deletedDateTime: null,
    subject: null,
    summary: null,
    locale: "en-AU",
    webUrl: null,
    replyToId: null,
    attachments: [],
    mentions: [],
    reactions: [],
    ...partial,
  });

  // Seed Chat Messages
  const chatMessages: GraphChatMessage[] = [
    makeChatMessage({
      id: String(now - 30 * 60 * 1000),
      importance: "normal",
      body: { contentType: "text", content: "Hey, are we still on for the 9 AM site visit?" },
      from: { user: { id: "user-sitemanager", displayName: "Site Manager", userIdentityType: "aadUser" } },
      chatId: oneOnOneChatId,
    }),
    makeChatMessage({
      id: String(now - 2 * 60 * 60 * 1000),
      importance: "normal",
      body: { contentType: "text", content: "Just confirming all equipment is packed for Westfield Tower tomorrow." },
      from: { user: { id: firstUser.oid, displayName: firstUser.name, userIdentityType: "aadUser" } },
      chatId: groupChatId,
    }),
  ];
  store.setData(STORE_KEY_CHAT_MESSAGES, chatMessages);

  // Helper to build a full contact
  const makeContact = (
    partial: Pick<
      GraphContact,
      | "id"
      | "displayName"
      | "givenName"
      | "surname"
      | "emailAddresses"
      | "businessPhones"
      | "mobilePhone"
      | "jobTitle"
      | "companyName"
    >,
  ): GraphContact => ({
    createdDateTime: new Date(now - 90 * DAY).toISOString(),
    lastModifiedDateTime: new Date(now - 30 * DAY).toISOString(),
    changeKey: `changekey-${randomBytes(4).toString("hex")}`,
    categories: [],
    parentFolderId: "contacts",
    fileAs: `${partial.surname}, ${partial.givenName}`,
    initials: null,
    middleName: null,
    nickName: null,
    title: null,
    generation: null,
    department: null,
    officeLocation: null,
    profession: null,
    assistantName: null,
    manager: null,
    homePhones: [],
    imAddresses: [],
    homeAddress: {},
    businessAddress: {},
    otherAddress: {},
    spouseName: null,
    personalNotes: null,
    children: [],
    birthday: null,
    businessHomePage: null,
    yomiCompanyName: null,
    yomiGivenName: null,
    yomiSurname: null,
    ...partial,
  });

  // Seed contacts
  const contacts: GraphContact[] = [
    makeContact({
      id: `contact-${randomBytes(6).toString("hex")}`,
      displayName: "Site Manager",
      givenName: "Site",
      surname: "Manager",
      emailAddresses: [{ name: "Site Manager", address: "sites@agent-emulate.dev" }],
      businessPhones: ["+61 2 9000 0001"],
      mobilePhone: "+61 400 000 001",
      jobTitle: "Site Manager",
      companyName: "Fireguard",
    }),
    makeContact({
      id: `contact-${randomBytes(6).toString("hex")}`,
      displayName: "Compliance Team",
      givenName: "Compliance",
      surname: "Team",
      emailAddresses: [{ name: "Compliance Team", address: "compliance@agent-emulate.dev" }],
      businessPhones: ["+61 2 9000 0002"],
      mobilePhone: null,
      jobTitle: "Compliance Officer",
      companyName: "Fireguard",
    }),
    makeContact({
      id: `contact-${randomBytes(6).toString("hex")}`,
      displayName: "Billing System",
      givenName: "Billing",
      surname: "System",
      emailAddresses: [{ name: "Billing System", address: "billing@agent-emulate.dev" }],
      businessPhones: ["+61 2 9000 0003"],
      mobilePhone: null,
      jobTitle: "Finance Officer",
      companyName: "Fireguard",
    }),
  ];
  store.setData(STORE_KEY_CONTACTS, contacts);

  // Seed team members
  const teamMembers: GraphTeamMember[] = [
    {
      id: `member-${randomBytes(6).toString("hex")}`,
      displayName: firstUser.name,
      email: firstUser.email,
      roles: ["owner"],
      userId: firstUser.oid,
      teamId,
    },
    {
      id: `member-${randomBytes(6).toString("hex")}`,
      displayName: "Site Manager",
      email: "sites@agent-emulate.dev",
      roles: ["member"],
      userId: "user-sitemanager",
      teamId,
    },
    {
      id: `member-${randomBytes(6).toString("hex")}`,
      displayName: "Compliance Team",
      email: "compliance@agent-emulate.dev",
      roles: ["member"],
      userId: "user-compliance",
      teamId,
    },
  ];
  // Add chat members too
  const chatMembersOneOnOne: GraphTeamMember[] = [
    {
      id: `cm-${randomBytes(6).toString("hex")}`,
      displayName: firstUser.name,
      email: firstUser.email,
      roles: [],
      userId: firstUser.oid,
      chatId: oneOnOneChatId,
    },
    {
      id: `cm-${randomBytes(6).toString("hex")}`,
      displayName: "Site Manager",
      email: "sites@agent-emulate.dev",
      roles: [],
      userId: "user-sitemanager",
      chatId: oneOnOneChatId,
    },
  ];
  const chatMembersGroup: GraphTeamMember[] = [
    {
      id: `cm-${randomBytes(6).toString("hex")}`,
      displayName: firstUser.name,
      email: firstUser.email,
      roles: ["owner"],
      userId: firstUser.oid,
      chatId: groupChatId,
    },
    {
      id: `cm-${randomBytes(6).toString("hex")}`,
      displayName: "Compliance Team",
      email: "compliance@agent-emulate.dev",
      roles: [],
      userId: "user-compliance",
      chatId: groupChatId,
    },
    {
      id: `cm-${randomBytes(6).toString("hex")}`,
      displayName: "Billing System",
      email: "billing@agent-emulate.dev",
      roles: [],
      userId: "user-billing",
      chatId: groupChatId,
    },
  ];
  store.setData(STORE_KEY_TEAM_MEMBERS, [...teamMembers, ...chatMembersOneOnOne, ...chatMembersGroup]);

  // Subscriptions start empty
  store.setData(STORE_KEY_SUBSCRIPTIONS, []);

  debug(
    "microsoft.graph",
    `[Graph seed] ${folders.length} folders, ${messages.length} messages, ${calendars.length} calendars, ${events.length} events, ${driveItems.length} drive items, ${teams.length} teams, ${channels.length} channels, ${channelMessages.length} channel messages, ${chats.length} chats, ${chatMessages.length} chat messages, ${contacts.length} contacts`,
  );
}

export function graphRoutes({ app, store, baseUrl }: RouteContext): void {
  const ms = getMicrosoftStore(store);

  // Intercept path-based drive uploads: PUT /v1.0/me/drive/root:/{path}:/content
  // Must be registered before other routes since Hono can't match literal colons.
  app.use("/v1.0/me/drive/*", async (c, next) => {
    if (c.req.method !== "PUT") return next();
    const match = c.req.path.match(/\/drive\/root:(.+):\/content$/);
    if (!match) return next();
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const filePath = match[1];
    const fileName = filePath.split("/").pop() ?? "file";
    const contentType = c.req.header("content-type") ?? "application/octet-stream";
    const text = await c.req.text();
    const items = getDriveItems(store);
    const existing = items.find((i) => i.name === fileName);
    const nowIso = new Date().toISOString();
    let item: GraphDriveItem;
    if (!existing) {
      item = buildDriveItem(
        {
          id: `item-${randomBytes(6).toString("hex")}`,
          name: fileName,
          size: text.length,
          webUrl: `${baseUrl}/drive/root:${filePath}`,
          createdDateTime: nowIso,
          lastModifiedDateTime: nowIso,
          file: { mimeType: contentType },
          parentReference: { id: "root", path: "/drive/root:" },
        },
        { id: "system", displayName: "System" },
      );
      items.push(item);
    } else {
      existing.size = text.length;
      existing.file = { mimeType: contentType };
      existing.lastModifiedDateTime = nowIso;
      item = existing;
    }
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    const content = getDriveContent(store);
    content[item.id] = text;
    store.setData(STORE_KEY_DRIVE_CONTENT, content);
    debug("microsoft.graph", `[Graph] Uploaded via path: ${filePath}`);
    return c.json(item, 201);
  });

  // Intercept path-based drive addressing: GET /v1.0/me/drive/root:/{path}
  // Registered before the literal routes since Hono can't match literal colons.
  app.use("/v1.0/me/drive/*", async (c, next) => {
    if (c.req.method !== "GET") return next();
    const match = c.req.path.match(/\/drive\/root:\/(.+)$/);
    if (!match) return next();
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const segments = match[1]
      .split("/")
      .map((s) => decodeURIComponent(s))
      .filter(Boolean);
    const items = getDriveItems(store);
    // Strict walk from root, then fall back to a global name match on the leaf.
    let parentId = "root";
    let current: GraphDriveItem | undefined;
    for (const seg of segments) {
      current = items.find((i) => i.parentReference?.id === parentId && i.name === seg);
      if (!current) break;
      parentId = current.id;
    }
    if (!current) {
      const leaf = segments[segments.length - 1];
      current = items.find((i) => i.name === leaf);
    }
    if (!current) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    return c.json(current);
  });

  // ========== OUTLOOK MAIL ==========

  app.get("/v1.0/me/mailFolders", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const folders = getMailFolders(store);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#mailFolders`,
      value: folders,
    });
  });

  app.get("/v1.0/me/mailFolders/:folderId/messages", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const folderId = c.req.param("folderId");
    const messages = getMessages(store).filter((m) => m.parentFolderId === folderId);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#messages`,
      value: messages,
    });
  });

  app.get("/v1.0/me/messages", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messages = getMessages(store);
    const top = parseInt(c.req.query("$top") ?? "25", 10);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#messages`,
      value: messages.slice(0, top),
    });
  });

  app.get("/v1.0/me/messages/:messageId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const message = getMessages(store).find((m) => m.id === messageId);
    if (!message) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    return c.json(message);
  });

  // ========== OUTLOOK CALENDAR ==========

  app.get("/v1.0/me/calendars", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const calendars = getCalendars(store);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#calendars`,
      value: calendars,
    });
  });

  app.get("/v1.0/me/calendarview", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const startDateTime = c.req.query("startDateTime") ?? c.req.query("startdatetime");
    const endDateTime = c.req.query("endDateTime") ?? c.req.query("enddatetime");

    let events = getEvents(store);
    if (startDateTime) {
      const start = new Date(startDateTime).getTime();
      events = events.filter((e) => new Date(e.start.dateTime).getTime() >= start);
    }
    if (endDateTime) {
      const end = new Date(endDateTime).getTime();
      events = events.filter((e) => new Date(e.end.dateTime).getTime() <= end);
    }

    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#calendarView`,
      value: events,
    });
  });

  app.get("/v1.0/me/events", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const events = getEvents(store);
    const top = parseInt(c.req.query("$top") ?? "50", 10);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#events`,
      value: events.slice(0, top),
    });
  });

  app.post("/v1.0/me/events", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const body = (await c.req.json()) as Record<string, unknown>;
    const calendars = getCalendars(store);
    const defaultCal = calendars.find((cal) => cal.isDefaultCalendar) ?? calendars[0];

    const authUser = requireAuth(c);
    const user = authUser ? ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]) : undefined;

    const eventId = `evt-${randomBytes(6).toString("hex")}`;
    const newEvent = buildEvent(
      {
        id: eventId,
        subject: (body.subject as string) ?? "New Event",
        start: body.start as GraphEvent["start"],
        end: body.end as GraphEvent["end"],
        location: (body.location as GraphEvent["location"]) ?? { displayName: "", locationType: "default" },
        isAllDay: (body.isAllDay as boolean) ?? false,
        calendarId: defaultCal?.id ?? "default",
        attendees: (body.attendees as GraphAttendee[]) ?? [],
      },
      baseUrl,
      { emailAddress: { name: user?.name ?? "Unknown", address: user?.email ?? "unknown@agent-emulate.dev" } },
    );

    const events = getEvents(store);
    events.push(newEvent);
    store.setData(STORE_KEY_EVENTS, events);

    debug("microsoft.graph", `[Graph] Created event: ${newEvent.subject}`);
    return c.json(newEvent, 201);
  });

  app.patch("/v1.0/me/events/:eventId", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const eventId = c.req.param("eventId");
    const events = getEvents(store);
    const event = events.find((e) => e.id === eventId);
    if (!event) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    if (body.subject) event.subject = body.subject as string;
    if (body.start) event.start = body.start as GraphEvent["start"];
    if (body.end) event.end = body.end as GraphEvent["end"];
    if (body.location) event.location = body.location as GraphEvent["location"];
    if (body.isAllDay !== undefined) event.isAllDay = body.isAllDay as boolean;

    store.setData(STORE_KEY_EVENTS, events);
    debug("microsoft.graph", `[Graph] Updated event: ${event.subject}`);
    return c.json(event);
  });

  app.delete("/v1.0/me/events/:eventId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const eventId = c.req.param("eventId");
    const events = getEvents(store);
    const idx = events.findIndex((e) => e.id === eventId);
    if (idx === -1) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }

    events.splice(idx, 1);
    store.setData(STORE_KEY_EVENTS, events);
    debug("microsoft.graph", `[Graph] Deleted event: ${eventId}`);
    return c.body(null, 204);
  });

  // ========== ONEDRIVE ==========

  app.get("/v1.0/me/drive", (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }

    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#drives/$entity`,
      id: `drive-${user?.oid ?? "default"}`,
      driveType: "business",
      owner: {
        user: {
          displayName: user?.name ?? authUser.login,
          id: user?.oid ?? "unknown",
        },
      },
      quota: {
        total: 1099511627776,
        used: 52428800,
        remaining: 1099459198976,
        state: "normal",
      },
    });
  });

  app.get("/v1.0/me/drive/root/children", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const items = getDriveItems(store).filter((item) => item.parentReference?.id === "root");
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems`,
      value: items,
    });
  });

  // ========== TEAMS ==========

  app.get("/v1.0/me/joinedTeams", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teams = getTeams(store);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#teams`,
      value: teams,
    });
  });

  app.get("/v1.0/teams/:teamId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const team = getTeams(store).find((t) => t.id === teamId);
    if (!team) {
      return c.json(graphError("ErrorItemNotFound", "The specified team was not found."), 404);
    }
    return c.json(team);
  });

  app.get("/v1.0/teams/:teamId/channels", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const channels = getChannels(store).filter((ch) => ch.teamId === teamId);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#channels`,
      value: channels,
    });
  });

  app.get("/v1.0/teams/:teamId/channels/:channelId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");
    const channel = getChannels(store).find((ch) => ch.teamId === teamId && ch.id === channelId);
    if (!channel) {
      return c.json(graphError("ErrorItemNotFound", "The specified channel was not found."), 404);
    }
    return c.json(channel);
  });

  app.get("/v1.0/teams/:teamId/channels/:channelId/messages", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");
    const top = parseInt(c.req.query("$top") ?? "50", 10);
    const messages = getChannelMessages(store)
      .filter((m) => m.channelIdentity?.teamId === teamId && m.channelIdentity?.channelId === channelId && !m.replyToId)
      .sort((a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime())
      .slice(0, top);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#chatMessages`,
      value: messages,
    });
  });

  app.post("/v1.0/teams/:teamId/channels/:channelId/messages", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");

    const channel = getChannels(store).find((ch) => ch.teamId === teamId && ch.id === channelId);
    if (!channel) {
      return c.json(graphError("ErrorItemNotFound", "The specified channel was not found."), 404);
    }

    const body = (await c.req.json()) as {
      body?: { contentType?: "text" | "html"; content?: string };
      subject?: string | null;
      importance?: "normal" | "high" | "urgent";
    };

    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const nowMs = Date.now();
    const newMessage: GraphChatMessage = {
      id: String(nowMs),
      etag: String(nowMs),
      messageType: "message",
      createdDateTime: new Date(nowMs).toISOString(),
      lastModifiedDateTime: new Date(nowMs).toISOString(),
      lastEditedDateTime: null,
      deletedDateTime: null,
      subject: body.subject ?? null,
      summary: null,
      importance: body.importance ?? "normal",
      locale: "en-US",
      webUrl: `${baseUrl}/teams/${teamId}/channels/${channelId}/messages/${nowMs}`,
      body: {
        contentType: body.body?.contentType ?? "html",
        content: body.body?.content ?? "",
      },
      from: {
        user: {
          id: user?.oid ?? "unknown",
          displayName: user?.name ?? authUser.login,
          userIdentityType: "aadUser",
        },
      },
      channelIdentity: { channelId, teamId },
      replyToId: null,
      attachments: [],
      mentions: [],
      reactions: [],
    };

    const messages = getChannelMessages(store);
    messages.push(newMessage);
    store.setData(STORE_KEY_CHANNEL_MESSAGES, messages);

    debug("microsoft.graph", `[Graph] Posted channel message to ${channel.displayName}`);
    return c.json(newMessage, 201);
  });

  app.get("/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");
    const messageId = c.req.param("messageId");
    const replies = getChannelMessages(store).filter(
      (m) =>
        m.channelIdentity?.teamId === teamId && m.channelIdentity?.channelId === channelId && m.replyToId === messageId,
    );
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#chatMessages`,
      value: replies,
    });
  });

  app.post("/v1.0/teams/:teamId/channels/:channelId/messages/:messageId/replies", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const channelId = c.req.param("channelId");
    const messageId = c.req.param("messageId");

    const body = (await c.req.json()) as {
      body?: { contentType?: "text" | "html"; content?: string };
    };

    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const nowMs = Date.now();
    const reply: GraphChatMessage = {
      id: String(nowMs),
      etag: String(nowMs),
      messageType: "message",
      createdDateTime: new Date(nowMs).toISOString(),
      lastModifiedDateTime: new Date(nowMs).toISOString(),
      lastEditedDateTime: null,
      deletedDateTime: null,
      subject: null,
      summary: null,
      importance: "normal",
      locale: "en-US",
      webUrl: `${baseUrl}/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies/${nowMs}`,
      body: {
        contentType: body.body?.contentType ?? "html",
        content: body.body?.content ?? "",
      },
      from: {
        user: {
          id: user?.oid ?? "unknown",
          displayName: user?.name ?? authUser.login,
          userIdentityType: "aadUser",
        },
      },
      channelIdentity: { channelId, teamId },
      replyToId: messageId,
      attachments: [],
      mentions: [],
      reactions: [],
    };

    const messages = getChannelMessages(store);
    messages.push(reply);
    store.setData(STORE_KEY_CHANNEL_MESSAGES, messages);
    return c.json(reply, 201);
  });

  // ========== CHATS (1:1 and group) ==========

  app.get("/v1.0/me/chats", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const chats = getChats(store);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#chats`,
      value: chats,
    });
  });

  app.get("/v1.0/chats/:chatId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const chatId = c.req.param("chatId");
    const chat = getChats(store).find((ch) => ch.id === chatId);
    if (!chat) {
      return c.json(graphError("ErrorItemNotFound", "The specified chat was not found."), 404);
    }
    return c.json(chat);
  });

  app.get("/v1.0/chats/:chatId/messages", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const chatId = c.req.param("chatId");
    const top = parseInt(c.req.query("$top") ?? "50", 10);
    const messages = getChatMessages(store)
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime())
      .slice(0, top);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#chatMessages`,
      value: messages,
    });
  });

  app.post("/v1.0/chats/:chatId/messages", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const chatId = c.req.param("chatId");

    const chat = getChats(store).find((ch) => ch.id === chatId);
    if (!chat) {
      return c.json(graphError("ErrorItemNotFound", "The specified chat was not found."), 404);
    }

    const body = (await c.req.json()) as {
      body?: { contentType?: "text" | "html"; content?: string };
      importance?: "normal" | "high" | "urgent";
    };

    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const nowMs = Date.now();
    const newMessage: GraphChatMessage = {
      id: String(nowMs),
      etag: String(nowMs),
      messageType: "message",
      createdDateTime: new Date(nowMs).toISOString(),
      lastModifiedDateTime: new Date(nowMs).toISOString(),
      lastEditedDateTime: null,
      deletedDateTime: null,
      subject: null,
      summary: null,
      importance: body.importance ?? "normal",
      locale: "en-US",
      webUrl: null,
      body: {
        contentType: body.body?.contentType ?? "text",
        content: body.body?.content ?? "",
      },
      from: {
        user: {
          id: user?.oid ?? "unknown",
          displayName: user?.name ?? authUser.login,
          userIdentityType: "aadUser",
        },
      },
      chatId,
      replyToId: null,
      attachments: [],
      mentions: [],
      reactions: [],
    };

    const messages = getChatMessages(store);
    messages.push(newMessage);
    store.setData(STORE_KEY_CHAT_MESSAGES, messages);

    // Update chat lastUpdatedDateTime
    const chats = getChats(store);
    const chatIdx = chats.findIndex((ch) => ch.id === chatId);
    if (chatIdx !== -1) {
      chats[chatIdx].lastUpdatedDateTime = new Date(nowMs).toISOString();
      store.setData(STORE_KEY_CHATS, chats);
    }

    debug("microsoft.graph", `[Graph] Posted chat message to ${chatId}`);
    return c.json(newMessage, 201);
  });

  // ========== USER PROFILE ==========

  app.get("/v1.0/me", (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#users/$entity`,
      id: user?.oid ?? "unknown",
      displayName: user?.name ?? authUser.login,
      givenName: user?.given_name ?? "",
      surname: user?.family_name ?? "",
      mail: user?.email ?? authUser.login,
      userPrincipalName: user?.preferred_username ?? authUser.login,
      jobTitle: null,
      officeLocation: null,
      preferredLanguage: "en-AU",
    });
  });

  app.get("/v1.0/users", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const users = ms.users.all().map((u) => ({
      id: u.oid,
      displayName: u.name,
      givenName: u.given_name,
      surname: u.family_name,
      mail: u.email,
      userPrincipalName: u.preferred_username,
    }));
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#users`,
      value: users,
    });
  });

  app.get("/v1.0/users/:userId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const userId = c.req.param("userId");
    const user = ms.users.findOneBy("oid", userId) ?? ms.users.findOneBy("email", userId);
    if (!user) {
      return c.json(graphError("Request_ResourceNotFound", "Resource not found."), 404);
    }
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#users/$entity`,
      id: user.oid,
      displayName: user.name,
      givenName: user.given_name,
      surname: user.family_name,
      mail: user.email,
      userPrincipalName: user.preferred_username,
      jobTitle: null,
      officeLocation: null,
    });
  });

  // ========== MAIL MUTATIONS ==========

  app.get("/v1.0/me/mailFolders/:folderId/childFolders", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const folderId = c.req.param("folderId");
    const children = getMailFolders(store).filter((f) => f.parentFolderId === folderId);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#mailFolders`,
      value: children,
    });
  });

  app.post("/v1.0/me/mailFolders", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const body = (await c.req.json()) as {
      displayName: string;
      parentFolderId?: string;
    };
    const folder: GraphMailFolder = {
      id: `folder-${randomBytes(6).toString("hex")}`,
      displayName: body.displayName,
      parentFolderId: body.parentFolderId ?? null,
      childFolderCount: 0,
      totalItemCount: 0,
      unreadItemCount: 0,
      isHidden: false,
    };
    const folders = getMailFolders(store);
    folders.push(folder);
    store.setData(STORE_KEY_FOLDERS, folders);
    return c.json(folder, 201);
  });

  app.post("/v1.0/me/messages", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const folders = getMailFolders(store);
    const draftsFolder = folders.find((f) => f.displayName === "Drafts");
    const body = (await c.req.json()) as Partial<GraphMessage>;
    const msgId = `msg-${randomBytes(6).toString("hex")}`;
    const fromRecipient: GraphRecipient = {
      emailAddress: { name: user?.name ?? authUser.login, address: user?.email ?? authUser.login },
    };
    const draft = buildMessage(
      {
        id: msgId,
        subject: body.subject ?? "(No subject)",
        bodyPreview: (body.body?.content ?? "").substring(0, 255),
        body: body.body ?? { contentType: "text", content: "" },
        from: fromRecipient,
        toRecipients: body.toRecipients ?? [],
        ccRecipients: body.ccRecipients ?? [],
        bccRecipients: body.bccRecipients ?? [],
        receivedDateTime: new Date().toISOString(),
        isRead: true,
        isDraft: true,
        parentFolderId: draftsFolder?.id ?? "drafts",
      },
      baseUrl,
    );
    const messages = getMessages(store);
    messages.push(draft);
    store.setData(STORE_KEY_MESSAGES, messages);
    debug("microsoft.graph", `[Graph] Created draft: ${draft.subject}`);
    return c.json(draft, 201);
  });

  app.patch("/v1.0/me/messages/:messageId", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const messages = getMessages(store);
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const body = (await c.req.json()) as Partial<GraphMessage>;
    if (body.subject !== undefined) msg.subject = body.subject;
    if (body.body !== undefined) msg.body = body.body;
    if (body.toRecipients !== undefined) msg.toRecipients = body.toRecipients;
    if (body.ccRecipients !== undefined) msg.ccRecipients = body.ccRecipients;
    if (body.bccRecipients !== undefined) msg.bccRecipients = body.bccRecipients;
    if (body.isRead !== undefined) msg.isRead = body.isRead;
    store.setData(STORE_KEY_MESSAGES, messages);
    return c.json(msg);
  });

  app.delete("/v1.0/me/messages/:messageId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const messages = getMessages(store);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    messages.splice(idx, 1);
    store.setData(STORE_KEY_MESSAGES, messages);
    debug("microsoft.graph", `[Graph] Deleted message: ${messageId}`);
    return c.body(null, 204);
  });

  app.post("/v1.0/me/sendMail", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const body = (await c.req.json()) as {
      message: Partial<GraphMessage>;
      saveToSentItems?: boolean;
    };

    const folders = getMailFolders(store);
    const sentFolder = folders.find((f) => f.displayName === "Sent Items");
    const nowIso = new Date().toISOString();
    const fromRecipient: GraphRecipient = {
      emailAddress: {
        name: user?.name ?? authUser.login,
        address: user?.email ?? authUser.login,
      },
    };
    const sent = buildMessage(
      {
        id: `msg-${randomBytes(6).toString("hex")}`,
        subject: body.message.subject ?? "(No subject)",
        bodyPreview: (body.message.body?.content ?? "").substring(0, 255),
        body: body.message.body ?? { contentType: "text", content: "" },
        from: fromRecipient,
        toRecipients: body.message.toRecipients ?? [],
        ccRecipients: body.message.ccRecipients ?? [],
        bccRecipients: body.message.bccRecipients ?? [],
        receivedDateTime: nowIso,
        sentDateTime: nowIso,
        isRead: true,
        isDraft: false,
        parentFolderId: sentFolder?.id ?? "sentitems",
      },
      baseUrl,
    );

    if (body.saveToSentItems !== false) {
      const messages = getMessages(store);
      messages.push(sent);
      store.setData(STORE_KEY_MESSAGES, messages);
    }

    debug("microsoft.graph", `[Graph] Sent mail: ${sent.subject}`);
    return c.body(null, 202);
  });

  app.post("/v1.0/me/messages/:messageId/send", (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const messages = getMessages(store);
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const folders = getMailFolders(store);
    const sentFolder = folders.find((f) => f.displayName === "Sent Items");
    msg.isDraft = false;
    msg.sentDateTime = new Date().toISOString();
    msg.parentFolderId = sentFolder?.id ?? msg.parentFolderId;
    store.setData(STORE_KEY_MESSAGES, messages);
    debug("microsoft.graph", `[Graph] Sent draft: ${msg.subject}`);
    return c.body(null, 202);
  });

  app.post("/v1.0/me/messages/:messageId/reply", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const original = getMessages(store).find((m) => m.id === messageId);
    if (!original) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const body = (await c.req.json()) as {
      comment?: string;
      message?: Partial<GraphMessage>;
    };
    const folders = getMailFolders(store);
    const sentFolder = folders.find((f) => f.displayName === "Sent Items");
    const nowIso = new Date().toISOString();
    const reply = buildMessage(
      {
        id: `msg-${randomBytes(6).toString("hex")}`,
        subject: `RE: ${original.subject}`,
        bodyPreview: (body.comment ?? "").substring(0, 255),
        body: { contentType: "text", content: body.comment ?? "" },
        from: {
          emailAddress: {
            name: user?.name ?? authUser.login,
            address: user?.email ?? authUser.login,
          },
        },
        toRecipients: [original.from],
        ccRecipients: [],
        bccRecipients: [],
        receivedDateTime: nowIso,
        sentDateTime: nowIso,
        isRead: true,
        isDraft: false,
        parentFolderId: sentFolder?.id ?? "sentitems",
      },
      baseUrl,
    );
    const messages = getMessages(store);
    messages.push(reply);
    store.setData(STORE_KEY_MESSAGES, messages);
    debug("microsoft.graph", `[Graph] Replied to: ${original.subject}`);
    return c.body(null, 202);
  });

  app.post("/v1.0/me/messages/:messageId/replyAll", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const original = getMessages(store).find((m) => m.id === messageId);
    if (!original) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const body = (await c.req.json()) as { comment?: string };
    const folders = getMailFolders(store);
    const sentFolder = folders.find((f) => f.displayName === "Sent Items");
    const nowIso = new Date().toISOString();
    const replyAll = buildMessage(
      {
        id: `msg-${randomBytes(6).toString("hex")}`,
        subject: `RE: ${original.subject}`,
        bodyPreview: (body.comment ?? "").substring(0, 255),
        body: { contentType: "text", content: body.comment ?? "" },
        from: {
          emailAddress: {
            name: user?.name ?? authUser.login,
            address: user?.email ?? authUser.login,
          },
        },
        toRecipients: [original.from, ...original.toRecipients],
        ccRecipients: original.ccRecipients,
        bccRecipients: [],
        receivedDateTime: nowIso,
        sentDateTime: nowIso,
        isRead: true,
        isDraft: false,
        parentFolderId: sentFolder?.id ?? "sentitems",
      },
      baseUrl,
    );
    const messages = getMessages(store);
    messages.push(replyAll);
    store.setData(STORE_KEY_MESSAGES, messages);
    return c.body(null, 202);
  });

  app.post("/v1.0/me/messages/:messageId/forward", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const original = getMessages(store).find((m) => m.id === messageId);
    if (!original) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const body = (await c.req.json()) as {
      toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
      comment?: string;
    };
    const folders = getMailFolders(store);
    const sentFolder = folders.find((f) => f.displayName === "Sent Items");
    const nowIso = new Date().toISOString();
    const fwd = buildMessage(
      {
        id: `msg-${randomBytes(6).toString("hex")}`,
        subject: `FW: ${original.subject}`,
        bodyPreview: (body.comment ?? "").substring(0, 255),
        body: {
          contentType: "html",
          content: `${body.comment ?? ""}<br><br>--- Forwarded message ---<br>${original.body.content}`,
        },
        from: {
          emailAddress: {
            name: user?.name ?? authUser.login,
            address: user?.email ?? authUser.login,
          },
        },
        toRecipients: body.toRecipients,
        ccRecipients: [],
        bccRecipients: [],
        receivedDateTime: nowIso,
        sentDateTime: nowIso,
        isRead: true,
        isDraft: false,
        parentFolderId: sentFolder?.id ?? "sentitems",
      },
      baseUrl,
    );
    const messages = getMessages(store);
    messages.push(fwd);
    store.setData(STORE_KEY_MESSAGES, messages);
    debug("microsoft.graph", `[Graph] Forwarded: ${original.subject}`);
    return c.body(null, 202);
  });

  app.post("/v1.0/me/messages/:messageId/move", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const messageId = c.req.param("messageId");
    const messages = getMessages(store);
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const body = (await c.req.json()) as { destinationId: string };
    msg.parentFolderId = body.destinationId;
    store.setData(STORE_KEY_MESSAGES, messages);
    debug("microsoft.graph", `[Graph] Moved message ${messageId} to folder ${body.destinationId}`);
    return c.json(msg);
  });

  // ========== CALENDAR ADDITIONS ==========

  app.get("/v1.0/me/events/:eventId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const eventId = c.req.param("eventId");
    const event = getEvents(store).find((e) => e.id === eventId);
    if (!event) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    return c.json(event);
  });

  app.post("/v1.0/me/calendars", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const body = (await c.req.json()) as { name: string; color?: string };
    const calendar: GraphCalendar = {
      id: `cal-${randomBytes(6).toString("hex")}`,
      name: body.name,
      color: body.color ?? "auto",
      isDefaultCalendar: false,
      canEdit: true,
      owner: {
        name: user?.name ?? authUser.login,
        address: user?.email ?? authUser.login,
      },
    };
    const calendars = getCalendars(store);
    calendars.push(calendar);
    store.setData(STORE_KEY_CALENDARS, calendars);
    debug("microsoft.graph", `[Graph] Created calendar: ${calendar.name}`);
    return c.json(calendar, 201);
  });

  app.get("/v1.0/me/calendars/:calendarId/events", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const calendarId = c.req.param("calendarId");
    const top = parseInt(c.req.query("$top") ?? "50", 10);
    const events = getEvents(store)
      .filter((e) => e.calendarId === calendarId)
      .slice(0, top);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#events`,
      value: events,
    });
  });

  // ========== ONEDRIVE FULL CRUD ==========

  app.get("/v1.0/me/drive/search", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const q = (c.req.query("q") ?? "").toLowerCase();
    const items = getDriveItems(store).filter((item) => !q || item.name.toLowerCase().includes(q));
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems`,
      value: items,
    });
  });

  app.get("/v1.0/me/drive/items/:itemId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const item = getDriveItems(store).find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    return c.json(item);
  });

  app.get("/v1.0/me/drive/items/:itemId/children", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const children = getDriveItems(store).filter((item) => item.parentReference?.id === itemId);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems`,
      value: children,
    });
  });

  app.post("/v1.0/me/drive/root/children", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const body = (await c.req.json()) as {
      name: string;
      folder?: Record<string, unknown>;
      "@microsoft.graph.conflictBehavior"?: string;
    };
    const nowIso = new Date().toISOString();
    const newItem: GraphDriveItem = {
      id: `item-${randomBytes(6).toString("hex")}`,
      name: body.name,
      description: "",
      size: 0,
      eTag: `"{${randomBytes(8).toString("hex").toUpperCase()},1}"`,
      cTag: `"c:{${randomBytes(8).toString("hex").toUpperCase()},1}"`,
      webUrl: `${baseUrl}/drive/root/${body.name}`,
      webDavUrl: `${baseUrl}/drive/root/${body.name}`,
      createdDateTime: nowIso,
      lastModifiedDateTime: nowIso,
      createdBy: { user: { id: "unknown", displayName: "unknown" } },
      lastModifiedBy: { user: { id: "unknown", displayName: "unknown" } },
      fileSystemInfo: { createdDateTime: nowIso, lastModifiedDateTime: nowIso },
      folder: body.folder ? { childCount: 0 } : undefined,
      parentReference: { id: "root", driveType: "business", path: "/drive/root:" },
    };
    const items = getDriveItems(store);
    items.push(newItem);
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    debug("microsoft.graph", `[Graph] Created drive item: ${newItem.name}`);
    return c.json(newItem, 201);
  });

  app.put("/v1.0/me/drive/items/:itemId/content", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const items = getDriveItems(store);
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    const contentType = c.req.header("content-type") ?? "application/octet-stream";
    const text = await c.req.text();
    const content = getDriveContent(store);
    content[itemId] = text;
    store.setData(STORE_KEY_DRIVE_CONTENT, content);
    item.size = text.length;
    item.file = { mimeType: contentType };
    item.lastModifiedDateTime = new Date().toISOString();
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    debug("microsoft.graph", `[Graph] Uploaded content to: ${item.name}`);
    return c.json(item);
  });

  // (path-based drive upload handled by middleware above)

  app.get("/v1.0/me/drive/items/:itemId/content", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const item = getDriveItems(store).find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    const content = getDriveContent(store);
    const data = content[itemId];
    if (data === undefined) {
      // Return empty body for items with no content
      return c.body("", 200);
    }
    return c.text(data, 200, {
      "Content-Type": item.file?.mimeType ?? "application/octet-stream",
    });
  });

  app.patch("/v1.0/me/drive/items/:itemId", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const items = getDriveItems(store);
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    const body = (await c.req.json()) as Partial<GraphDriveItem>;
    if (body.name) item.name = body.name;
    if (body.parentReference) item.parentReference = body.parentReference;
    item.lastModifiedDateTime = new Date().toISOString();
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    debug("microsoft.graph", `[Graph] Updated drive item: ${item.name}`);
    return c.json(item);
  });

  app.delete("/v1.0/me/drive/items/:itemId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const items = getDriveItems(store);
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    items.splice(idx, 1);
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    // Also remove any stored content
    const content = getDriveContent(store);
    delete content[itemId];
    store.setData(STORE_KEY_DRIVE_CONTENT, content);
    debug("microsoft.graph", `[Graph] Deleted drive item: ${itemId}`);
    return c.body(null, 204);
  });

  const SYSTEM_OWNER: GraphIdentity = { id: "system", displayName: "System" };

  // GET /v1.0/me/drive/root — the synthetic root DriveItem (a folder)
  app.get("/v1.0/me/drive/root", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const nowIso = new Date().toISOString();
    const childCount = getDriveItems(store).filter((i) => i.parentReference?.id === "root").length;
    return c.json(
      buildDriveItem(
        {
          id: "root",
          name: "root",
          size: 0,
          webUrl: `${baseUrl}/drive/root`,
          createdDateTime: nowIso,
          lastModifiedDateTime: nowIso,
          folder: { childCount },
        },
        SYSTEM_OWNER,
      ),
    );
  });

  // GET /v1.0/me/drive/root/delta — all items plus a deltaLink
  app.get("/v1.0/me/drive/root/delta", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const token = c.req.query("token") ?? randomBytes(8).toString("hex");
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems`,
      value: getDriveItems(store),
      "@odata.deltaLink": `${baseUrl}/v1.0/me/drive/root/delta?token=${token}`,
    });
  });

  // GET /v1.0/me/drive/recent — recently used files
  app.get("/v1.0/me/drive/recent", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const files = getDriveItems(store).filter((i) => !i.folder);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems`,
      value: files,
    });
  });

  // GET /v1.0/me/drive/sharedWithMe — items shared with the signed-in user
  app.get("/v1.0/me/drive/sharedWithMe", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems`,
      value: [],
    });
  });

  // GET /v1.0/me/drive/items/:itemId/thumbnails — thumbnail set
  app.get("/v1.0/me/drive/items/:itemId/thumbnails", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const item = getDriveItems(store).find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    const thumbUrl = (size: string) => `${baseUrl}/drive/items/${itemId}/thumbnails/0/${size}/content`;
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#driveItems('${itemId}')/thumbnails`,
      value: [
        {
          id: "0",
          small: { width: 48, height: 48, url: thumbUrl("small") },
          medium: { width: 176, height: 176, url: thumbUrl("medium") },
          large: { width: 800, height: 800, url: thumbUrl("large") },
        },
      ],
    });
  });

  // POST /v1.0/me/drive/items/:itemId/children — create a child in a folder
  app.post("/v1.0/me/drive/items/:itemId/children", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const parentId = c.req.param("itemId");
    const body = (await c.req.json()) as {
      name: string;
      folder?: Record<string, unknown>;
      file?: Record<string, unknown>;
    };
    const nowIso = new Date().toISOString();
    const newItem = buildDriveItem(
      {
        id: `item-${randomBytes(6).toString("hex")}`,
        name: body.name,
        size: 0,
        webUrl: `${baseUrl}/drive/items/${parentId}/${body.name}`,
        createdDateTime: nowIso,
        lastModifiedDateTime: nowIso,
        parentReference: { id: parentId, driveType: "business", path: `/drive/items/${parentId}` },
        ...(body.folder ? { folder: { childCount: 0 } } : {}),
      },
      SYSTEM_OWNER,
    );
    const items = getDriveItems(store);
    items.push(newItem);
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    debug("microsoft.graph", `[Graph] Created child of ${parentId}: ${newItem.name}`);
    return c.json(newItem, 201);
  });

  // POST /v1.0/me/drive/items/:itemId/copy — async copy (202 + Location monitor)
  app.post("/v1.0/me/drive/items/:itemId/copy", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const sourceId = c.req.param("itemId");
    const items = getDriveItems(store);
    const source = items.find((i) => i.id === sourceId);
    if (!source) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      parentReference?: { id: string };
    };
    const copyId = `item-${randomBytes(6).toString("hex")}`;
    const nowIso = new Date().toISOString();
    const copy = buildDriveItem(
      {
        ...source,
        id: copyId,
        name: body.name ?? source.name,
        createdDateTime: nowIso,
        lastModifiedDateTime: nowIso,
        parentReference: body.parentReference
          ? { id: body.parentReference.id, driveType: "business", path: `/drive/items/${body.parentReference.id}` }
          : source.parentReference,
      },
      SYSTEM_OWNER,
    );
    items.push(copy);
    store.setData(STORE_KEY_DRIVE_ITEMS, items);
    const content = getDriveContent(store);
    if (content[sourceId] !== undefined) {
      content[copyId] = content[sourceId];
      store.setData(STORE_KEY_DRIVE_CONTENT, content);
    }
    debug("microsoft.graph", `[Graph] Copied ${sourceId} -> ${copyId}`);
    c.header("Location", `${baseUrl}/v1.0/me/drive/items/${sourceId}/copy/monitor/${copyId}`);
    return c.body(null, 202);
  });

  // POST /v1.0/me/drive/items/:itemId/createLink — create a sharing link
  app.post("/v1.0/me/drive/items/:itemId/createLink", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const item = getDriveItems(store).find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { type?: string; scope?: string };
    const type = body.type ?? "view";
    const scope = body.scope ?? "anonymous";
    return c.json(
      {
        id: `perm-${randomBytes(6).toString("hex")}`,
        roles: [type === "edit" ? "write" : "read"],
        link: {
          type,
          scope,
          webUrl: `${baseUrl}/personal/share/${itemId}?e=${randomBytes(4).toString("hex")}`,
          preventsDownload: false,
        },
      },
      201,
    );
  });

  // GET /v1.0/drives/:driveId/items/:itemId — drive-scoped addressing
  app.get("/v1.0/drives/:driveId/items/:itemId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const itemId = c.req.param("itemId");
    const item = getDriveItems(store).find((i) => i.id === itemId);
    if (!item) {
      return c.json(graphError("itemNotFound", "The resource could not be found."), 404);
    }
    return c.json(item);
  });

  // ========== CONTACTS ==========

  app.get("/v1.0/me/contacts", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const top = parseInt(c.req.query("$top") ?? "25", 10);
    const contacts = getContacts(store).slice(0, top);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#contacts`,
      value: contacts,
    });
  });

  app.post("/v1.0/me/contacts", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const body = (await c.req.json()) as Partial<GraphContact>;
    const nowIso = new Date().toISOString();
    const contact: GraphContact = {
      id: `contact-${randomBytes(6).toString("hex")}`,
      createdDateTime: nowIso,
      lastModifiedDateTime: nowIso,
      changeKey: `changekey-${randomBytes(4).toString("hex")}`,
      categories: [],
      parentFolderId: "contacts",
      fileAs: body.displayName ?? `${body.givenName ?? ""} ${body.surname ?? ""}`.trim(),
      displayName: body.displayName ?? `${body.givenName ?? ""} ${body.surname ?? ""}`.trim(),
      givenName: body.givenName ?? "",
      initials: null,
      middleName: null,
      nickName: null,
      surname: body.surname ?? "",
      title: null,
      generation: null,
      jobTitle: body.jobTitle ?? null,
      companyName: body.companyName ?? null,
      department: null,
      officeLocation: null,
      profession: null,
      assistantName: null,
      manager: null,
      homePhones: [],
      mobilePhone: body.mobilePhone ?? null,
      businessPhones: body.businessPhones ?? [],
      imAddresses: [],
      emailAddresses: body.emailAddresses ?? [],
      homeAddress: {},
      businessAddress: {},
      otherAddress: {},
      spouseName: null,
      personalNotes: null,
      children: [],
      birthday: null,
      businessHomePage: null,
      yomiCompanyName: null,
      yomiGivenName: null,
      yomiSurname: null,
    };
    const contacts = getContacts(store);
    contacts.push(contact);
    store.setData(STORE_KEY_CONTACTS, contacts);
    debug("microsoft.graph", `[Graph] Created contact: ${contact.displayName}`);
    return c.json(contact, 201);
  });

  app.get("/v1.0/me/contacts/:contactId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const contactId = c.req.param("contactId");
    const contact = getContacts(store).find((ct) => ct.id === contactId);
    if (!contact) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    return c.json(contact);
  });

  app.patch("/v1.0/me/contacts/:contactId", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const contactId = c.req.param("contactId");
    const contacts = getContacts(store);
    const contact = contacts.find((ct) => ct.id === contactId);
    if (!contact) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    const body = (await c.req.json()) as Partial<GraphContact>;
    if (body.displayName !== undefined) contact.displayName = body.displayName;
    if (body.givenName !== undefined) contact.givenName = body.givenName;
    if (body.surname !== undefined) contact.surname = body.surname;
    if (body.emailAddresses !== undefined) contact.emailAddresses = body.emailAddresses;
    if (body.businessPhones !== undefined) contact.businessPhones = body.businessPhones;
    if (body.mobilePhone !== undefined) contact.mobilePhone = body.mobilePhone;
    if (body.jobTitle !== undefined) contact.jobTitle = body.jobTitle;
    if (body.companyName !== undefined) contact.companyName = body.companyName;
    contact.lastModifiedDateTime = new Date().toISOString();
    store.setData(STORE_KEY_CONTACTS, contacts);
    return c.json(contact);
  });

  app.delete("/v1.0/me/contacts/:contactId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const contactId = c.req.param("contactId");
    const contacts = getContacts(store);
    const idx = contacts.findIndex((ct) => ct.id === contactId);
    if (idx === -1) {
      return c.json(graphError("ErrorItemNotFound", "The specified object was not found."), 404);
    }
    contacts.splice(idx, 1);
    store.setData(STORE_KEY_CONTACTS, contacts);
    return c.body(null, 204);
  });

  // ========== TEAMS MUTATIONS ==========

  app.get("/v1.0/teams", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teams = getTeams(store);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#teams`,
      value: teams,
    });
  });

  app.post("/v1.0/teams", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const body = (await c.req.json()) as Partial<GraphTeam> & {
      "template@odata.bind"?: string;
    };
    const newTeamId = `team-${randomBytes(6).toString("hex")}`;
    const newTeam: GraphTeam = {
      id: newTeamId,
      createdDateTime: new Date().toISOString(),
      displayName: body.displayName ?? "New Team",
      description: body.description ?? "",
      internalId: randomBytes(8).toString("hex"),
      classification: null,
      specialization: "none",
      visibility: body.visibility ?? "private",
      isArchived: false,
      tenantId: "common",
      webUrl: `${baseUrl}/teams/${newTeamId}`,
      memberSettings: {
        allowCreateUpdateChannels: true,
        allowDeleteChannels: false,
        allowAddRemoveApps: true,
        allowCreateUpdateRemoveTabs: true,
        allowCreateUpdateRemoveConnectors: true,
      },
      guestSettings: { allowCreateUpdateChannels: false, allowDeleteChannels: false },
      messagingSettings: {
        allowUserEditMessages: true,
        allowUserDeleteMessages: true,
        allowOwnerDeleteMessages: true,
        allowTeamMentions: true,
        allowChannelMentions: true,
      },
      funSettings: {
        allowGiphy: true,
        giphyContentRating: "moderate",
        allowStickersAndMemes: true,
        allowCustomMemes: true,
      },
    };
    const teams = getTeams(store);
    teams.push(newTeam);
    store.setData(STORE_KEY_TEAMS, teams);

    // Seed a General channel for the new team
    const generalId = `19:${randomBytes(8).toString("hex")}@thread.tacv2`;
    const channels = getChannels(store);
    channels.push({
      id: generalId,
      createdDateTime: new Date().toISOString(),
      displayName: "General",
      description: "General discussion",
      email: "",
      tenantId: "common",
      webUrl: `${baseUrl}/teams/${newTeamId}/channels/${generalId}`,
      membershipType: "standard",
      isArchived: false,
      isFavoriteByDefault: null,
      teamId: newTeamId,
    });
    store.setData(STORE_KEY_CHANNELS, channels);

    debug("microsoft.graph", `[Graph] Created team: ${newTeam.displayName}`);
    // Real API returns 202 with a provisioning status header
    return c.json(newTeam, 201);
  });

  app.post("/v1.0/teams/:teamId/channels", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const team = getTeams(store).find((t) => t.id === teamId);
    if (!team) {
      return c.json(graphError("ErrorItemNotFound", "The specified team was not found."), 404);
    }
    const body = (await c.req.json()) as Partial<GraphChannel>;
    const channelId = `19:${randomBytes(8).toString("hex")}@thread.tacv2`;
    const channel: GraphChannel = {
      id: channelId,
      createdDateTime: new Date().toISOString(),
      displayName: body.displayName ?? "New Channel",
      description: body.description ?? "",
      email: "",
      tenantId: "common",
      webUrl: `${baseUrl}/teams/${teamId}/channels/${channelId}`,
      membershipType: body.membershipType ?? "standard",
      isArchived: false,
      isFavoriteByDefault: null,
      teamId,
    };
    const channels = getChannels(store);
    channels.push(channel);
    store.setData(STORE_KEY_CHANNELS, channels);
    debug("microsoft.graph", `[Graph] Created channel: ${channel.displayName}`);
    return c.json(channel, 201);
  });

  app.get("/v1.0/teams/:teamId/members", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const teamId = c.req.param("teamId");
    const members = getTeamMembers(store).filter((m) => m.teamId === teamId && !m.chatId);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#teams('${teamId}')/members`,
      value: members,
    });
  });

  app.get("/v1.0/chats/:chatId/members", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const chatId = c.req.param("chatId");
    const members = getTeamMembers(store).filter((m) => m.chatId === chatId);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#chats('${chatId}')/members`,
      value: members,
    });
  });

  app.post("/v1.0/me/chats", async (c) => {
    const authUser = requireAuth(c);
    if (!authUser) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const user = ms.users.findOneBy("email", authUser.login as MicrosoftUser["email"]);
    const body = (await c.req.json()) as {
      chatType: "oneOnOne" | "group" | "meeting";
      topic?: string;
      members: Array<{ "@odata.type": string; roles: string[]; "user@odata.bind": string }>;
    };

    const nowMs = Date.now();
    const isOneOnOne = body.chatType === "oneOnOne";
    const chatId = isOneOnOne
      ? `19:${randomBytes(8).toString("hex")}_${randomBytes(8).toString("hex")}@unq.gbl.spaces`
      : `19:${randomBytes(16).toString("hex")}@thread.v2`;

    const chat: GraphChat = {
      id: chatId,
      topic: body.topic ?? null,
      createdDateTime: new Date(nowMs).toISOString(),
      lastUpdatedDateTime: new Date(nowMs).toISOString(),
      chatType: body.chatType,
      webUrl: `${baseUrl}/chats/${chatId}`,
      tenantId: "common",
      isHiddenForAllMembers: false,
      onlineMeetingInfo: null,
      viewpoint: null,
    };
    const chats = getChats(store);
    chats.push(chat);
    store.setData(STORE_KEY_CHATS, chats);

    // Add self as member
    const allMembers = getTeamMembers(store);
    allMembers.push({
      id: `cm-${randomBytes(6).toString("hex")}`,
      displayName: user?.name ?? authUser.login,
      email: user?.email ?? authUser.login,
      roles: ["owner"],
      userId: user?.oid ?? "unknown",
      chatId,
    });
    store.setData(STORE_KEY_TEAM_MEMBERS, allMembers);

    debug("microsoft.graph", `[Graph] Created chat: ${chatId}`);
    return c.json(chat, 201);
  });

  // ========== WEBHOOKS / SUBSCRIPTIONS ==========

  app.get("/v1.0/subscriptions", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const subs = getSubscriptions(store);
    return c.json({
      "@odata.context": `${baseUrl}/v1.0/$metadata#subscriptions`,
      value: subs,
    });
  });

  app.post("/v1.0/subscriptions", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const body = (await c.req.json()) as {
      changeType: string;
      notificationUrl: string;
      resource: string;
      expirationDateTime: string;
      clientState?: string;
      latestSupportedTlsVersion?: string;
    };

    const sub: GraphSubscription = {
      id: `sub-${randomBytes(6).toString("hex")}`,
      resource: body.resource,
      changeType: body.changeType,
      notificationUrl: body.notificationUrl,
      expirationDateTime: body.expirationDateTime,
      clientState: body.clientState ?? null,
      createdDateTime: new Date().toISOString(),
      applicationId: null,
      creatorId: null,
      latestSupportedTlsVersion: body.latestSupportedTlsVersion ?? "v1_2",
      lifecycleNotificationUrl: null,
      encryptionCertificate: null,
      encryptionCertificateId: null,
      includeResourceData: false,
      notificationQueryOptions: null,
      notificationUrlAppId: null,
    };
    const subs = getSubscriptions(store);
    subs.push(sub);
    store.setData(STORE_KEY_SUBSCRIPTIONS, subs);
    debug("microsoft.graph", `[Graph] Created subscription: ${sub.resource} (${sub.changeType})`);
    return c.json(sub, 201);
  });

  app.get("/v1.0/subscriptions/:subscriptionId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const subscriptionId = c.req.param("subscriptionId");
    const sub = getSubscriptions(store).find((s) => s.id === subscriptionId);
    if (!sub) {
      return c.json(graphError("ExtensionError", "The subscription was not found."), 404);
    }
    return c.json(sub);
  });

  app.patch("/v1.0/subscriptions/:subscriptionId", async (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const subscriptionId = c.req.param("subscriptionId");
    const subs = getSubscriptions(store);
    const sub = subs.find((s) => s.id === subscriptionId);
    if (!sub) {
      return c.json(graphError("ExtensionError", "The subscription was not found."), 404);
    }
    const body = (await c.req.json()) as { expirationDateTime?: string };
    if (body.expirationDateTime) sub.expirationDateTime = body.expirationDateTime;
    store.setData(STORE_KEY_SUBSCRIPTIONS, subs);
    debug("microsoft.graph", `[Graph] Renewed subscription: ${sub.resource}`);
    return c.json(sub);
  });

  app.delete("/v1.0/subscriptions/:subscriptionId", (c) => {
    if (!requireAuth(c)) {
      return c.json(graphError("InvalidAuthenticationToken", "Authentication required."), 401);
    }
    const subscriptionId = c.req.param("subscriptionId");
    const subs = getSubscriptions(store);
    const idx = subs.findIndex((s) => s.id === subscriptionId);
    if (idx === -1) {
      return c.json(graphError("ExtensionError", "The subscription was not found."), 404);
    }
    subs.splice(idx, 1);
    store.setData(STORE_KEY_SUBSCRIPTIONS, subs);
    debug("microsoft.graph", `[Graph] Deleted subscription: ${subscriptionId}`);
    return c.body(null, 204);
  });
}
