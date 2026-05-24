import type { RouteContext } from "@emulators/core";
import { escapeHtml, renderSettingsPage } from "@emulators/core";
import { getWorkOSStore } from "../store.js";

const SERVICE_LABEL = "WorkOS";

function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function statusBadge(status: string): string {
  const cls = status === "active" || status === "pending" ? "badge-granted" : "badge-denied";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function roleBadge(role: string): string {
  return `<span class="badge badge-requested">${escapeHtml(role)}</span>`;
}

export function inspectorRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = () => getWorkOSStore(store);

  app.get("/", (c) => {
    const tab = c.req.query("tab") ?? "users";
    const w = ws();

    const users = w.allUsers();
    const orgs: ReturnType<typeof w.getOrg>[] = [];
    // Collect all orgs via membership cross-reference
    const orgIds = new Set<string>();
    for (const u of users) {
      for (const m of w.getUserMemberships(u.id)) {
        orgIds.add(m.organization_id);
      }
    }
    // Also grab invitations to find org IDs
    const allInvitations: ReturnType<typeof w.listInvitations>[] = [];

    const sidebar = `
<a href="/?tab=users"${tab === "users" ? ' class="active"' : ""}>Users (${users.length})</a>
<a href="/?tab=orgs"${tab === "orgs" ? ' class="active"' : ""}>Organizations</a>
<a href="/?tab=memberships"${tab === "memberships" ? ' class="active"' : ""}>Memberships</a>
<a href="/?tab=invitations"${tab === "invitations" ? ' class="active"' : ""}>Invitations</a>`;

    let bodyHtml = "";

    if (tab === "users") {
      const rows =
        users.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No users seeded yet.</td></tr>`
          : users
              .map(
                (u) => `
<tr>
  <td><span class="org-icon" style="display:inline-flex;width:28px;height:28px;font-size:.75rem">${escapeHtml((u.first_name?.[0] ?? u.email[0]).toUpperCase())}</span></td>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(u.email)}</span></td>
  <td>${escapeHtml([u.first_name, u.last_name].filter(Boolean).join(" ") || "—")}</td>
  <td>${u.email_verified ? '<span class="badge badge-granted">verified</span>' : '<span class="badge badge-denied">unverified</span>'}</td>
  <td style="color:#1a8c00;font-size:.75rem">${timeAgo(u.created_at)}</td>
</tr>`,
              )
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Users</h2>
  <table class="inspector-table">
    <thead><tr><th></th><th>Email</th><th>Name</th><th>Verified</th><th>Created</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "orgs") {
      // Collect all unique org IDs from all memberships for all users
      const orgMap = new Map<string, { name: string; slug: string; memberCount: number; createdAt: string }>();
      for (const u of users) {
        for (const m of w.getUserMemberships(u.id)) {
          if (!orgMap.has(m.organization_id)) {
            const org = w.getOrg(m.organization_id);
            if (org) {
              orgMap.set(org.id, { name: org.name, slug: org.slug, memberCount: 0, createdAt: org.created_at });
            }
          }
          const entry = orgMap.get(m.organization_id);
          if (entry) entry.memberCount++;
        }
      }

      const rows =
        orgMap.size === 0
          ? `<tr><td colspan="4" class="inspector-empty">No organizations found.</td></tr>`
          : [...orgMap.entries()]
              .map(
                ([id, org]) => `
<tr>
  <td><span class="org-icon" style="display:inline-flex;width:28px;height:28px;font-size:.75rem">${escapeHtml(org.name[0].toUpperCase())}</span></td>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(org.name)}</span><br><span style="color:#1a8c00;font-size:.75rem">${escapeHtml(org.slug)}</span></td>
  <td style="color:#1a8c00">${escapeHtml(id)}</td>
  <td>${org.memberCount} member${org.memberCount !== 1 ? "s" : ""}</td>
</tr>`,
              )
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Organizations</h2>
  <table class="inspector-table">
    <thead><tr><th></th><th>Name / Slug</th><th>ID</th><th>Members</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "memberships") {
      const rows: string[] = [];
      for (const u of users) {
        for (const m of w.getUserMemberships(u.id)) {
          const org = w.getOrg(m.organization_id);
          rows.push(`
<tr>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(u.email)}</span></td>
  <td>${escapeHtml(org?.name ?? m.organization_id)}</td>
  <td>${roleBadge(m.role.slug)}</td>
  <td>${statusBadge(m.status)}</td>
  <td style="color:#1a8c00;font-size:.75rem">${timeAgo(m.created_at)}</td>
</tr>`);
        }
      }

      const tableRows =
        rows.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No memberships found.</td></tr>`
          : rows.join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Memberships</h2>
  <table class="inspector-table">
    <thead><tr><th>User</th><th>Organization</th><th>Role</th><th>Status</th><th>Created</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>`;
    }

    if (tab === "invitations") {
      // Collect invitations across all known org IDs
      const allOrgs = new Set<string>();
      for (const u of users) {
        for (const m of w.getUserMemberships(u.id)) {
          allOrgs.add(m.organization_id);
        }
      }
      const invs = [...allOrgs].flatMap((orgId) => w.listInvitations(orgId));

      const rows =
        invs.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No pending invitations.</td></tr>`
          : invs
              .map((inv) => {
                const org = w.getOrg(inv.organization_id);
                return `
<tr>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(inv.email)}</span></td>
  <td>${escapeHtml(org?.name ?? inv.organization_id)}</td>
  <td>${inv.role_slug ? roleBadge(inv.role_slug) : "—"}</td>
  <td>${statusBadge(inv.status)}</td>
  <td style="color:#1a8c00;font-size:.75rem">${timeAgo(inv.created_at)}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Invitations</h2>
  <table class="inspector-table">
    <thead><tr><th>Email</th><th>Organization</th><th>Role</th><th>Status</th><th>Sent</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    const stats = `${users.length} users · ${orgIds.size} orgs`;
    return c.html(
      renderSettingsPage(
        `WorkOS Inspector`,
        sidebar,
        `<div class="s-card">
  <div class="s-card-header">
    <div class="s-icon">W</div>
    <div>
      <div class="s-title">WorkOS User Management</div>
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
