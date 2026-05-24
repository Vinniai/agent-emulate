import { Hono } from "hono";
import { escapeHtml, escapeAttr, renderInspectorPage, type AppEnv, type InspectorTab } from "@emulators/core";
import { getNangoStore } from "@emulators/nango";
import type { ServiceApp, ServiceName } from "./dispatcher.js";

export interface InspectorState {
  apps: Map<ServiceName, ServiceApp>;
  baseUrl: string;
}

interface ModelInfo {
  model: string;
  collectionPath: string;
  idField: string;
  count: number;
}

// Services that ship their own richer HTML inspector — link straight to it
// instead of the generic snapshot view.
const NATIVE_INSPECTOR: Partial<Record<string, string>> = {
  simpro: "/simpro/inspector/customers",
  uptick: "/uptick/",
};

const TABS: InspectorTab[] = [{ id: "services", label: "All Services", href: "/_inspector" }];

const table = (headers: string[], rows: string[][]): string => {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body =
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="inspector-empty">Nothing seeded yet.</td></tr>`
      : rows.map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<table class="inspector-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
};

/** Ask a native-kit service for its model → native-path catalog. */
async function fetchModels(sa: ServiceApp, origin: string): Promise<ModelInfo[] | null> {
  try {
    const res = await sa.hono.fetch(new Request(`${origin}/_models`));
    if (res.status !== 200) return null;
    const body = (await res.json()) as { models?: ModelInfo[] };
    return body.models ?? null;
  } catch {
    return null;
  }
}

/** Generic fallback: total rows across every store collection. */
function snapshotRows(sa: ServiceApp): { name: string; count: number }[] {
  const snap = sa.store.snapshot();
  return Object.entries(snap.collections)
    .map(([name, col]) => ({ name, count: col.items.length }))
    .filter((c) => c.count > 0);
}

interface NangoRow {
  connectionId: string;
  provider: string;
  providerConfigKey: string;
  model: string;
  count: number;
}

/**
 * Nango is a proxy: connections + per-model records live in its own store
 * facade, not the generic `collections` snapshot. Read them directly so the
 * provider browser reflects live sync/forward activity.
 */
function nangoView(sa: ServiceApp): { connections: number; records: number; rows: NangoRow[] } {
  const ns = getNangoStore(sa.store);
  const conns = ns.listConnections();
  const rows: NangoRow[] = [];
  let records = 0;
  for (const conn of conns) {
    const byModel = ns.allRecordsForConnection(conn.id);
    const models = Object.entries(byModel);
    if (models.length === 0) {
      rows.push({
        connectionId: conn.id,
        provider: conn.provider,
        providerConfigKey: conn.provider_config_key,
        model: "—",
        count: 0,
      });
      continue;
    }
    for (const [model, items] of models) {
      const n = Array.isArray(items) ? items.length : 0;
      records += n;
      rows.push({
        connectionId: conn.id,
        provider: conn.provider,
        providerConfigKey: conn.provider_config_key,
        model,
        count: n,
      });
    }
  }
  return { connections: conns.length, records, rows };
}

export function createInspectorRouter(state: InspectorState): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const origin = new URL(state.baseUrl).origin;

  r.get("/_inspector", async (c) => {
    const names = [...state.apps.keys()].sort();
    const rows: string[][] = [];
    for (const name of names) {
      const sa = state.apps.get(name)!;
      const isNango = name === "nango";
      const models = isNango ? null : await fetchModels(sa, origin);
      let collections: { count: number; rows: number };
      let mode: string;
      if (isNango) {
        const nv = nangoView(sa);
        collections = { count: nv.connections, rows: nv.records };
        mode = "proxy (nango)";
      } else if (models) {
        collections = { count: models.length, rows: models.reduce((n, m) => n + m.count, 0) };
        mode = "direct (native-kit)";
      } else {
        const s = snapshotRows(sa);
        collections = { count: s.length, rows: s.reduce((n, x) => n + x.count, 0) };
        mode = "direct";
      }
      const native = NATIVE_INSPECTOR[name];
      const links = [
        `<a href="/_inspector/${escapeAttr(name)}">browse</a>`,
        native ? `<a href="${escapeAttr(native)}">native UI ↗</a>` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      rows.push([
        `<strong>${escapeHtml(name)}</strong>`,
        String(collections.count),
        String(collections.rows),
        mode,
        links,
      ]);
    }

    const body = `<div class="inspector-section">
  <h2>${names.length} emulated providers</h2>
  <p class="inspector-empty">Every provider is reachable direct-to-source at <code>${escapeHtml(state.baseUrl)}/&lt;provider&gt;</code>. Nango proxy mode stays available separately.</p>
  ${table(["Provider", "Collections", "Seeded rows", "Mode", ""], rows)}
</div>`;
    return c.html(renderInspectorPage("Provider Browser", TABS, "services", body, "emulate"));
  });

  r.get("/_inspector/:service", async (c) => {
    const name = c.req.param("service") as ServiceName;
    const sa = state.apps.get(name);
    if (!sa) {
      const body = `<div class="inspector-section"><h2>Unknown provider</h2><p class="inspector-empty">No service named <code>${escapeHtml(name)}</code> is mounted. <a href="/_inspector">Back to all providers</a>.</p></div>`;
      return c.html(renderInspectorPage("Provider Browser", TABS, "services", body, "emulate"), 404);
    }

    const isNango = name === "nango";
    const models = isNango ? null : await fetchModels(sa, origin);
    let inner: string;
    if (isNango) {
      const nv = nangoView(sa);
      const rows = nv.rows.map((rw) => [
        `<strong>${escapeHtml(rw.connectionId)}</strong>`,
        escapeHtml(rw.provider),
        `<code>${escapeHtml(rw.providerConfigKey)}</code>`,
        escapeHtml(rw.model),
        String(rw.count),
      ]);
      inner =
        `<p class="inspector-empty">${nv.connections} connection(s), ${nv.records} live record(s). Records stream in via sync/forward webhooks.</p>` +
        table(["Connection", "Provider", "Provider Config Key", "Model", "Records"], rows);
    } else if (models) {
      const rows = models.map((m) => [
        `<strong>${escapeHtml(m.model)}</strong>`,
        `<code>/${escapeHtml(name)}${escapeHtml(m.collectionPath)}</code>`,
        escapeHtml(m.idField),
        String(m.count),
      ]);
      inner = table(["Model", "Native path", "Id field", "Rows"], rows);
    } else {
      const snap = snapshotRows(sa).map((s) => [`<strong>${escapeHtml(s.name)}</strong>`, String(s.count)]);
      inner = table(["Collection", "Rows"], snap);
    }

    const native = NATIVE_INSPECTOR[name];
    const body = `<div class="inspector-section">
  <h2>${escapeHtml(name)}</h2>
  <p class="inspector-empty">
    Base URL <code>${escapeHtml(state.baseUrl)}/${escapeHtml(name)}</code>
    ${native ? `· <a href="${escapeAttr(native)}">open native UI ↗</a>` : ""}
    · <a href="/_inspector">all providers</a>
  </p>
  ${inner}
</div>`;
    return c.html(renderInspectorPage("Provider Browser", TABS, "services", body, "emulate"));
  });

  return r;
}
