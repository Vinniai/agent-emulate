import type { RouteContext } from "@emulators/core";
import { escapeHtml, renderSettingsPage } from "@emulators/core";
import { getUptickStore } from "../store.js";

function activeBadge(active: boolean): string {
  return active
    ? `<span class="badge badge-granted">Active</span>`
    : `<span class="badge badge-denied">Inactive</span>`;
}

function statusBadge(status: string): string {
  const open = ["open", "pending"];
  const closed = ["resolved", "closed", "completed"];
  const cls = closed.includes(status.toLowerCase())
    ? "badge-granted"
    : open.includes(status.toLowerCase())
      ? "badge-requested"
      : "badge-denied";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

export function inspectorRoutes({ app, store }: RouteContext): void {
  const us = () => getUptickStore(store);

  app.get("/", (c) => {
    const tab = c.req.query("tab") ?? "clients";
    const s = us();

    const clients = s.clients.all();
    const properties = s.properties.all();
    const assets = s.assets.all();
    const defects = s.defects.all();
    const assetTypes = s.assetTypes.all();
    const users = s.users.all();

    const sidebar = `
<a href="/?tab=clients"${tab === "clients" ? ' class="active"' : ""}>Clients (${clients.length})</a>
<a href="/?tab=properties"${tab === "properties" ? ' class="active"' : ""}>Properties (${properties.length})</a>
<a href="/?tab=assets"${tab === "assets" ? ' class="active"' : ""}>Assets (${assets.length})</a>
<a href="/?tab=defects"${tab === "defects" ? ' class="active"' : ""}>Defects (${defects.length})</a>
<a href="/?tab=reference"${tab === "reference" ? ' class="active"' : ""}>Reference</a>`;

    let bodyHtml = "";

    if (tab === "clients") {
      const rows =
        clients.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No clients yet.</td></tr>`
          : clients
              .map(
                (cl) => `
<tr>
  <td style="color:#1a8c00">${cl.id}</td>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(cl.name)}</span></td>
  <td>${escapeHtml(cl.contact_email)}</td>
  <td>${activeBadge(cl.is_active)}</td>
</tr>`,
              )
              .join("");
      bodyHtml = `
<div class="inspector-section">
  <h2>Clients</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Active</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    } else if (tab === "properties") {
      const rows =
        properties.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No properties yet.</td></tr>`
          : properties
              .map((p) => {
                const client = s.clients.get(p.client_id);
                return `
<tr>
  <td style="color:#1a8c00">${p.id}</td>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(p.name)}</span></td>
  <td>${escapeHtml(client?.name ?? String(p.client_id))}</td>
  <td>${escapeHtml(p.address_city)}</td>
  <td>${activeBadge(p.is_active)}</td>
</tr>`;
              })
              .join("");
      bodyHtml = `
<div class="inspector-section">
  <h2>Properties</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Name</th><th>Client</th><th>City</th><th>Active</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    } else if (tab === "assets") {
      const rows =
        assets.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No assets yet.</td></tr>`
          : assets
              .map((a) => {
                const property = a.property_id ? s.properties.get(a.property_id) : null;
                return `
<tr>
  <td style="color:#1a8c00">${a.id}</td>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(a.name)}</span></td>
  <td>${escapeHtml(a.asset_type_name)}</td>
  <td>${escapeHtml(property?.name ?? "—")}</td>
  <td>${activeBadge(a.is_active)}</td>
</tr>`;
              })
              .join("");
      bodyHtml = `
<div class="inspector-section">
  <h2>Assets</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Property</th><th>Active</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    } else if (tab === "defects") {
      const rows =
        defects.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No defects yet.</td></tr>`
          : defects
              .map((d) => {
                const asset = d.asset_id ? s.assets.get(d.asset_id) : null;
                return `
<tr>
  <td style="color:#1a8c00">${d.id}</td>
  <td>${escapeHtml(d.description.length > 60 ? d.description.slice(0, 60) + "…" : d.description)}</td>
  <td>${escapeHtml(d.severity || "—")}</td>
  <td>${statusBadge(d.status)}</td>
  <td>${escapeHtml(asset?.name ?? "—")}</td>
</tr>`;
              })
              .join("");
      bodyHtml = `
<div class="inspector-section">
  <h2>Defects</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Description</th><th>Severity</th><th>Status</th><th>Asset</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    } else if (tab === "reference") {
      bodyHtml = `
<div class="inspector-section">
  <h2>Reference Data</h2>
  <table class="inspector-table">
    <thead><tr><th>Entity</th><th>Count</th></tr></thead>
    <tbody>
      <tr><td>Asset Types</td><td>${assetTypes.length}</td></tr>
      <tr><td>Users</td><td>${users.length}</td></tr>
    </tbody>
  </table>
</div>
<div class="inspector-section" style="margin-top:16px">
  <h2>Asset Types</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Name</th><th>Description</th></tr></thead>
    <tbody>${assetTypes.length === 0 ? `<tr><td colspan="3" class="inspector-empty">No asset types yet.</td></tr>` : assetTypes.map((t) => `<tr><td style="color:#1a8c00">${t.id}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.description)}</td></tr>`).join("")}</tbody>
  </table>
</div>
<div class="inspector-section" style="margin-top:16px">
  <h2>Users</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Active</th></tr></thead>
    <tbody>${users.length === 0 ? `<tr><td colspan="4" class="inspector-empty">No users yet.</td></tr>` : users.map((u) => `<tr><td style="color:#1a8c00">${u.id}</td><td>${escapeHtml(`${u.first_name} ${u.last_name}`.trim())}</td><td>${escapeHtml(u.email)}</td><td>${activeBadge(u.is_active)}</td></tr>`).join("")}</tbody>
  </table>
</div>`;
    }

    const stats = `${clients.length} client${clients.length !== 1 ? "s" : ""} · ${properties.length} propert${properties.length !== 1 ? "ies" : "y"} · ${assets.length} asset${assets.length !== 1 ? "s" : ""} · ${defects.length} defect${defects.length !== 1 ? "s" : ""}`;

    return c.html(
      renderSettingsPage(
        "Uptick Inspector",
        sidebar,
        `<div class="s-card">
  <div class="s-card-header">
    <div class="s-icon">U</div>
    <div>
      <div class="s-title">Uptick Fire Protection</div>
      <div class="s-subtitle">${stats}</div>
    </div>
  </div>
  ${bodyHtml}
</div>`,
        "Uptick",
      ),
    );
  });
}
