import type { RouteContext } from "@emulators/core";
import { escapeHtml, renderSettingsPage } from "@emulators/core";
import { getMicrosoftStore } from "../store.js";

const SERVICE_LABEL = "Microsoft";

// Store keys mirror the private constants in graph.ts
const SK = {
  folders: "microsoft.graph.mailFolders",
  messages: "microsoft.graph.messages",
  events: "microsoft.graph.events",
  driveItems: "microsoft.graph.driveItems",
  teams: "microsoft.graph.teams",
  channels: "microsoft.graph.channels",
  channelMessages: "microsoft.graph.channelMessages",
  chats: "microsoft.graph.chats",
  chatMessages: "microsoft.graph.chatMessages",
  contacts: "microsoft.graph.contacts",
  subscriptions: "microsoft.graph.subscriptions",
} as const;

function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

export function inspectorRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  function get<T>(key: string): T[] {
    return store.getData<T[]>(key) ?? [];
  }

  app.get("/", (c) => {
    const tab = c.req.query("tab") ?? "mail";
    const ms = getMicrosoftStore(store);
    const users = ms.users.all();

    const messages = get<{
      id: string;
      subject: string;
      from: { emailAddress: { name: string; address: string } };
      receivedDateTime: string;
      isRead: boolean;
      isDraft: boolean;
      parentFolderId: string;
    }>(SK.messages);
    const events = get<{
      id: string;
      subject: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string };
      isAllDay: boolean;
      organizer: { emailAddress: { name: string } };
    }>(SK.events);
    const driveItems = get<{
      id: string;
      name: string;
      size: number;
      folder?: object;
      file?: { mimeType: string };
      lastModifiedDateTime: string;
    }>(SK.driveItems);
    const teams = get<{ id: string; displayName: string; description?: string; visibility: string }>(SK.teams);
    const channels = get<{ id: string; displayName: string; teamId: string; membershipType: string }>(SK.channels);
    const chats = get<{ id: string; topic: string | null; chatType: string; createdDateTime: string }>(SK.chats);
    const contacts = get<{
      id: string;
      displayName: string;
      emailAddresses: Array<{ address: string }>;
      mobilePhone: string | null;
      jobTitle: string | null;
    }>(SK.contacts);
    const subscriptions = get<{
      id: string;
      resource: string;
      changeType: string;
      expirationDateTime: string;
      notificationUrl: string;
    }>(SK.subscriptions);

    const sidebar = `
<a href="/?tab=mail"${tab === "mail" ? ' class="active"' : ""}>Mail (${messages.length})</a>
<a href="/?tab=calendar"${tab === "calendar" ? ' class="active"' : ""}>Calendar (${events.length})</a>
<a href="/?tab=drive"${tab === "drive" ? ' class="active"' : ""}>OneDrive (${driveItems.length})</a>
<a href="/?tab=teams"${tab === "teams" ? ' class="active"' : ""}>Teams (${teams.length})</a>
<a href="/?tab=contacts"${tab === "contacts" ? ' class="active"' : ""}>Contacts (${contacts.length})</a>
<a href="/?tab=subscriptions"${tab === "subscriptions" ? ' class="active"' : ""}>Webhooks (${subscriptions.length})</a>`;

    let bodyHtml = "";

    if (tab === "mail") {
      const sorted = [...messages].sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
      const rows =
        sorted.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No messages yet.</td></tr>`
          : sorted
              .slice(0, 50)
              .map(
                (m) => `
<tr>
  <td>
    <span style="color:#33ff00;font-weight:${m.isRead ? "400" : "600"}">${escapeHtml(m.subject || "(no subject)")}</span>
    ${m.isDraft ? '<span class="badge badge-requested" style="margin-left:4px">draft</span>' : ""}
  </td>
  <td><span style="color:#1a8c00">${escapeHtml(m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? "—")}</span></td>
  <td>${m.isRead ? "" : '<span class="badge badge-granted">unread</span>'}</td>
  <td style="color:#1a8c00;font-size:.75rem">${timeAgo(m.receivedDateTime)}</td>
</tr>`,
              )
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Inbox / Sent</h2>
  <table class="inspector-table">
    <thead><tr><th>Subject</th><th>From</th><th></th><th>Received</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "calendar") {
      const sorted = [...events].sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
      const rows =
        sorted.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No events yet.</td></tr>`
          : sorted
              .slice(0, 50)
              .map((e) => {
                const start = new Date(e.start.dateTime);
                const isPast = start < new Date();
                return `
<tr>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(e.subject)}</span></td>
  <td style="color:#1a8c00">${escapeHtml(e.organizer?.emailAddress?.name ?? "—")}</td>
  <td style="color:#1a8c00;font-size:.75rem">${shortDate(e.start.dateTime)}</td>
  <td>${isPast ? '<span class="badge badge-denied">past</span>' : '<span class="badge badge-granted">upcoming</span>'}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Events</h2>
  <table class="inspector-table">
    <thead><tr><th>Subject</th><th>Organizer</th><th>Date</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "drive") {
      const sorted = [...driveItems].sort((a, b) => b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime));
      const rows =
        sorted.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No files or folders yet.</td></tr>`
          : sorted
              .map((item) => {
                const isFolder = !!item.folder;
                const icon = isFolder ? "📁" : "📄";
                const sizeStr = isFolder
                  ? "—"
                  : item.size < 1024
                    ? `${item.size} B`
                    : `${(item.size / 1024).toFixed(1)} KB`;
                return `
<tr>
  <td><span style="font-size:1rem">${icon}</span> <span style="color:#33ff00;font-weight:600">${escapeHtml(item.name)}</span></td>
  <td><span style="color:#1a8c00;font-size:.75rem">${escapeHtml(item.file?.mimeType ?? (isFolder ? "folder" : "—"))}</span></td>
  <td style="color:#1a8c00;font-size:.75rem">${sizeStr}</td>
  <td style="color:#1a8c00;font-size:.75rem">${timeAgo(item.lastModifiedDateTime)}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>OneDrive Files</h2>
  <table class="inspector-table">
    <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "teams") {
      const teamRows =
        teams.length === 0
          ? `<tr><td colspan="3" class="inspector-empty">No teams yet.</td></tr>`
          : teams
              .map((t) => {
                const teamChannels = channels.filter((ch) => ch.teamId === t.id);
                return `
<tr>
  <td><span class="org-icon" style="display:inline-flex;width:28px;height:28px;font-size:.75rem">${escapeHtml(t.displayName[0])}</span></td>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(t.displayName)}</span><br><span style="color:#1a8c00;font-size:.75rem">${escapeHtml(t.description ?? "")}</span></td>
  <td>${teamChannels.map((ch) => `<span class="badge badge-requested"># ${escapeHtml(ch.displayName)}</span>`).join(" ")}</td>
</tr>`;
              })
              .join("");

      const chatRows =
        chats.length === 0
          ? `<tr><td colspan="3" class="inspector-empty">No chats yet.</td></tr>`
          : chats
              .map(
                (ch) => `
<tr>
  <td><span style="color:#33ff00">${escapeHtml(ch.topic ?? "(no topic)")}</span></td>
  <td><span class="badge badge-requested">${escapeHtml(ch.chatType)}</span></td>
  <td style="color:#1a8c00;font-size:.75rem">${timeAgo(ch.createdDateTime)}</td>
</tr>`,
              )
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Teams</h2>
  <table class="inspector-table">
    <thead><tr><th></th><th>Team</th><th>Channels</th></tr></thead>
    <tbody>${teamRows}</tbody>
  </table>
</div>
<div class="inspector-section">
  <h2>Chats</h2>
  <table class="inspector-table">
    <thead><tr><th>Topic</th><th>Type</th><th>Created</th></tr></thead>
    <tbody>${chatRows}</tbody>
  </table>
</div>`;
    }

    if (tab === "contacts") {
      const rows =
        contacts.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No contacts yet.</td></tr>`
          : contacts
              .map(
                (ct) => `
<tr>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(ct.displayName)}</span></td>
  <td><span style="color:#1a8c00">${escapeHtml(ct.emailAddresses?.[0]?.address ?? "—")}</span></td>
  <td style="color:#1a8c00">${escapeHtml(ct.jobTitle ?? "—")}</td>
  <td style="color:#1a8c00">${escapeHtml(ct.mobilePhone ?? "—")}</td>
</tr>`,
              )
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Contacts</h2>
  <table class="inspector-table">
    <thead><tr><th>Name</th><th>Email</th><th>Title</th><th>Mobile</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "subscriptions") {
      const rows =
        subscriptions.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No webhook subscriptions yet.</td></tr>`
          : subscriptions
              .map((s) => {
                const expired = new Date(s.expirationDateTime) < new Date();
                return `
<tr>
  <td><code style="color:#1a8c00;font-size:.75rem">${escapeHtml(s.resource)}</code></td>
  <td><span class="badge badge-requested">${escapeHtml(s.changeType)}</span></td>
  <td style="color:#1a8c00;font-size:.75rem;word-break:break-all">${escapeHtml(s.notificationUrl)}</td>
  <td>${expired ? '<span class="badge badge-denied">expired</span>' : `<span class="badge badge-granted">active</span> <span style="color:#1a8c00;font-size:.75rem">until ${shortDate(s.expirationDateTime)}</span>`}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Webhook Subscriptions</h2>
  <table class="inspector-table">
    <thead><tr><th>Resource</th><th>Change Types</th><th>Notification URL</th><th>Expiry</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    const stats = `${users.length} user${users.length !== 1 ? "s" : ""} · ${messages.length} messages · ${events.length} events · ${driveItems.length} files`;
    return c.html(
      renderSettingsPage(
        "Microsoft Inspector",
        sidebar,
        `<div class="s-card">
  <div class="s-card-header">
    <div class="s-icon">M</div>
    <div>
      <div class="s-title">Microsoft Graph</div>
      <div class="s-subtitle">${stats}</div>
    </div>
  </div>
  ${bodyHtml}
</div>`,
        SERVICE_LABEL,
      ),
    );
  });
}
