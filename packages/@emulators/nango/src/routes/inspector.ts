import type { RouteContext } from "@emulators/core";
import { escapeHtml, renderSettingsPage } from "@emulators/core";
import { getNangoStore } from "../store.js";

const SERVICE_LABEL = "Nango";

function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function providerIcon(provider: string): string {
  const icons: Record<string, string> = {
    xero: "X",
    quickbooks: "Q",
    hubspot: "H",
    myob: "M",
    salesforce: "SF",
    github: "G",
    slack: "S",
  };
  return icons[provider.toLowerCase()] ?? provider[0]?.toUpperCase() ?? "?";
}

export function inspectorRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ns = () => getNangoStore(store);

  app.get("/", (c) => {
    const selectedId = c.req.query("conn") ?? "";
    const n = ns();
    const connections = n.listConnections();

    if (connections.length === 0) {
      return c.html(
        renderSettingsPage(
          "Nango Inspector",
          "<p class='empty'>No connections</p>",
          "<p class='empty'>No connections seeded yet. Use POST /connection to create one.</p>",
          SERVICE_LABEL,
        ),
      );
    }

    const activeConn = connections.find((c) => c.id === selectedId) ?? connections[0];
    const records = n.allRecordsForConnection(activeConn.id);
    const modelNames = Object.keys(records);

    const sidebar = connections
      .map((conn) => {
        const active = conn.id === activeConn.id ? ' class="active"' : "";
        return `<a href="/?conn=${escapeHtml(conn.id)}"${active}>${escapeHtml(providerIcon(conn.provider))} ${escapeHtml(conn.id)}</a>`;
      })
      .join("\n");

    // Connection detail card
    const connCard = `
<div class="org-row">
  <span class="org-icon">${escapeHtml(providerIcon(activeConn.provider))}</span>
  <span>
    <span class="org-name">${escapeHtml(activeConn.id)}</span>
    <span class="badge badge-requested" style="margin-left:6px">${escapeHtml(activeConn.provider)}</span>
    <span class="badge badge-granted" style="margin-left:4px">${escapeHtml(activeConn.provider_config_key)}</span>
  </span>
  <span class="user-meta" style="margin-left:auto">${timeAgo(activeConn.updated_at)}</span>
</div>
${
  Object.keys(activeConn.metadata ?? {}).length > 0
    ? `
<div class="info-text" style="margin-top:8px">
  <strong>Metadata:</strong> <code style="color:#1a8c00;font-size:.75rem">${escapeHtml(JSON.stringify(activeConn.metadata))}</code>
</div>`
    : ""
}
${
  activeConn.connection_config && Object.keys(activeConn.connection_config).length > 0
    ? `
<div class="info-text">
  <strong>Config:</strong> <code style="color:#1a8c00;font-size:.75rem">${escapeHtml(JSON.stringify(activeConn.connection_config))}</code>
</div>`
    : ""
}`;

    // Records tables per model
    const recordsHtml =
      modelNames.length === 0
        ? `<div class="inspector-empty">No sync records for this connection.</div>`
        : modelNames
            .map((model) => {
              const rows = records[model] ?? [];
              const keys =
                rows.length > 0
                  ? Object.keys(rows[0])
                      .filter((k) => k !== "_nango_metadata")
                      .slice(0, 5)
                  : [];
              const tableRows = rows
                .slice(0, 25)
                .map((row) => `<tr>${keys.map((k) => `<td>${escapeHtml(String(row[k] ?? ""))}</td>`).join("")}</tr>`)
                .join("");
              const moreNote = rows.length > 25 ? `<p class="info-text">Showing 25 of ${rows.length} records.</p>` : "";
              return `
<div class="inspector-section">
  <h3>${escapeHtml(model)} <span class="badge badge-requested">${rows.length}</span></h3>
  ${
    keys.length === 0
      ? `<div class="inspector-empty">No records.</div>`
      : `<table class="inspector-table">
    <thead><tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>${moreNote}`
  }
</div>`;
            })
            .join("");

    const bodyHtml = `
<div class="inspector-section">
  <h2>Connection</h2>
  ${connCard}
</div>
<div class="inspector-section">
  <h2>Sync Records</h2>
  ${recordsHtml}
</div>`;

    const stats = `${connections.length} connection${connections.length !== 1 ? "s" : ""} · ${modelNames.length} model${modelNames.length !== 1 ? "s" : ""}`;
    return c.html(
      renderSettingsPage(
        "Nango Inspector",
        sidebar,
        `<div class="s-card">
  <div class="s-card-header">
    <div class="s-icon">N</div>
    <div>
      <div class="s-title">Nango Connections</div>
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
