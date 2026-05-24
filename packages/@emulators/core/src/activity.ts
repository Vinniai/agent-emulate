import type { Hono } from "hono";
import { escapeHtml } from "./ui.js";

export interface ActivityEvent {
  ts: number;
  service: string;
  entity: string;
  action: string;
  id: string;
  extra?: Record<string, unknown>;
}

const RING_SIZE = 200;

class ActivityBus {
  private buffer: ActivityEvent[] = [];
  private subscribers = new Set<(e: ActivityEvent) => void>();

  publish(event: ActivityEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > RING_SIZE) this.buffer.splice(0, this.buffer.length - RING_SIZE);
    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  subscribe(cb: (e: ActivityEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  recent(limit = 50, service?: string): ActivityEvent[] {
    const filtered = service ? this.buffer.filter((e) => e.service === service) : this.buffer;
    return filtered.slice(-limit).reverse();
  }
}

// Singleton across all bundled chunks. tsup multi-entry produces a separate
// copy of this module per entry — each would otherwise instantiate its own
// ActivityBus, so SSE readers in one chunk would miss writes published from
// another. Pin to globalThis so every chunk shares the same instance.
declare global {
  // eslint-disable-next-line no-var
  var __emulate_activity_bus__: ActivityBus | undefined;
}
export const activityBus: ActivityBus =
  globalThis.__emulate_activity_bus__ ?? (globalThis.__emulate_activity_bus__ = new ActivityBus());

export function registerActivityRoutes(app: Hono<any>, service?: string): void {
  app.get("/_activity/recent.json", (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    return c.json({ events: activityBus.recent(limit, service) });
  });

  app.get("/_activity/stream", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (evt: ActivityEvent): void => {
          if (service && evt.service !== service) return;
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(evt)}\n\n`));
          } catch {
            // closed
          }
        };
        controller.enqueue(enc.encode(`: connected\n\n`));
        const unsub = activityBus.subscribe(send);
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(enc.encode(`: ping\n\n`));
          } catch {
            // closed
          }
        }, 15_000);
        const close = (): void => {
          clearInterval(heartbeat);
          unsub();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        c.req.raw.signal.addEventListener("abort", close);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}

function summarizeData(data: unknown): string {
  if (data == null || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  const skip = new Set(["id", "_nango_metadata", "created_at", "updated_at"]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    if (v == null) continue;
    let s: string;
    if (typeof v === "string") s = v;
    else if (typeof v === "number" || typeof v === "boolean") s = String(v);
    else continue;
    if (s.length > 40) s = s.slice(0, 37) + "…";
    parts.push(`${k}=${s}`);
    if (parts.join(" · ").length > 140) break;
  }
  return parts.join(" · ");
}

function activityRowHtml(e: ActivityEvent, idx: number): string {
  const t = new Date(e.ts);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  const data = (e.extra as { data?: unknown } | undefined)?.data;
  const summary = summarizeData(data);
  const detailsId = `act-d-${e.ts}-${idx}`;
  const hasData = data != null && typeof data === "object";
  return `<tr data-ts="${e.ts}">
  <td style="font-family:monospace;color:#888;font-size:.75rem;white-space:nowrap">${hh}:${mm}:${ss}</td>
  <td><span class="badge badge-requested">${escapeHtml(e.service)}</span></td>
  <td><span class="badge badge-granted">${escapeHtml(e.action)}</span></td>
  <td style="white-space:nowrap">${escapeHtml(e.entity)}</td>
  <td style="font-family:monospace;font-size:.75rem;white-space:nowrap">${escapeHtml(e.id)}</td>
  <td style="font-size:.75rem;color:#555">${escapeHtml(summary)}</td>
  <td>${hasData ? `<button type="button" onclick="var el=document.getElementById('${detailsId}');el.style.display=el.style.display==='table-row'?'none':'table-row'" style="font-size:.7rem;padding:2px 6px;cursor:pointer">JSON</button>` : ""}</td>
</tr>${hasData ? `<tr id="${detailsId}" style="display:none"><td colspan="7" style="background:#fafafa;padding:6px 10px"><pre style="margin:0;font-size:.7rem;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto">${escapeHtml(JSON.stringify(data, null, 2))}</pre></td></tr>` : ""}`;
}

export function renderActivityCard(opts: { service?: string; limit?: number } = {}): string {
  const limit = opts.limit ?? 25;
  const initial = activityBus.recent(limit, opts.service);
  const rowsHtml = initial.map((e, i) => activityRowHtml(e, i)).join("");
  const serviceFilter = opts.service ? JSON.stringify(opts.service) : "null";
  return `
<div class="s-card" style="margin-bottom:16px">
  <div class="s-card-header">
    <div class="s-icon" style="background:#10b981">●</div>
    <div>
      <div class="s-title">Live Activity</div>
      <div class="s-subtitle"><span id="act-status">connecting…</span> · <span id="act-count">${initial.length}</span> recent events</div>
    </div>
  </div>
  <div class="inspector-section">
    <table class="inspector-table">
      <thead><tr><th>Time</th><th>Service</th><th>Action</th><th>Entity</th><th>ID</th><th>Fields</th><th></th></tr></thead>
      <tbody id="act-tbody">${rowsHtml || `<tr><td colspan="7" class="inspector-empty">No activity yet — events will stream in.</td></tr>`}</tbody>
    </table>
  </div>
</div>
<script>
(function(){
  var filter = ${serviceFilter};
  var max = ${limit};
  var tbody = document.getElementById('act-tbody');
  var status = document.getElementById('act-status');
  var countEl = document.getElementById('act-count');
  var es = new EventSource('/_activity/stream');
  es.onopen = function(){ status.textContent = 'live'; status.style.color = '#10b981'; };
  es.onerror = function(){ status.textContent = 'reconnecting…'; status.style.color = '#ef4444'; };
  function pad(n){ return String(n).padStart(2,'0'); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function summarize(d){
    if (!d || typeof d !== 'object') return '';
    var skip = {id:1,_nango_metadata:1,created_at:1,updated_at:1};
    var parts = [];
    for (var k in d) {
      if (skip[k]) continue;
      var v = d[k];
      if (v == null) continue;
      var s;
      if (typeof v === 'string') s = v;
      else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
      else continue;
      if (s.length > 40) s = s.slice(0,37)+'…';
      parts.push(k+'='+s);
      if (parts.join(' · ').length > 140) break;
    }
    return parts.join(' · ');
  }
  var seq = 0;
  es.onmessage = function(ev){
    try {
      var e = JSON.parse(ev.data);
      if (filter && e.service !== filter) return;
      var empty = tbody.querySelector('.inspector-empty');
      if (empty) { var er = empty.closest('tr'); if (er) er.remove(); }
      var t = new Date(e.ts);
      var data = e.extra && e.extra.data;
      var hasData = data && typeof data === 'object';
      var detailsId = 'act-d-' + e.ts + '-live-' + (seq++);
      var row = document.createElement('tr');
      row.setAttribute('data-ts', e.ts);
      var btn = hasData ? '<button type="button" onclick="var el=document.getElementById(\\''+detailsId+'\\');el.style.display=el.style.display===\\'table-row\\'?\\'none\\':\\'table-row\\'" style="font-size:.7rem;padding:2px 6px;cursor:pointer">JSON</button>' : '';
      row.innerHTML =
        '<td style="font-family:monospace;color:#888;font-size:.75rem;white-space:nowrap">' + pad(t.getHours())+':'+pad(t.getMinutes())+':'+pad(t.getSeconds()) + '</td>' +
        '<td><span class="badge badge-requested">' + esc(e.service) + '</span></td>' +
        '<td><span class="badge badge-granted">' + esc(e.action) + '</span></td>' +
        '<td style="white-space:nowrap">' + esc(e.entity) + '</td>' +
        '<td style="font-family:monospace;font-size:.75rem;white-space:nowrap">' + esc(e.id) + '</td>' +
        '<td style="font-size:.75rem;color:#555">' + esc(summarize(data)) + '</td>' +
        '<td>' + btn + '</td>';
      row.style.background = '#ecfdf5';
      tbody.insertBefore(row, tbody.firstChild);
      if (hasData) {
        var dr = document.createElement('tr');
        dr.id = detailsId;
        dr.style.display = 'none';
        dr.innerHTML = '<td colspan="7" style="background:#fafafa;padding:6px 10px"><pre style="margin:0;font-size:.7rem;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto">' + esc(JSON.stringify(data, null, 2)) + '</pre></td>';
        tbody.insertBefore(dr, row.nextSibling);
      }
      setTimeout(function(){ row.style.transition='background .8s'; row.style.background=''; }, 50);
      // Cap: count main rows (those with data-ts), trim oldest pair
      var mains = tbody.querySelectorAll('tr[data-ts]');
      while (mains.length > max) {
        var last = mains[mains.length-1];
        var next = last.nextSibling;
        if (next && next.id && next.id.indexOf('act-d-') === 0) tbody.removeChild(next);
        tbody.removeChild(last);
        mains = tbody.querySelectorAll('tr[data-ts]');
      }
      countEl.textContent = mains.length;
    } catch(_) {}
  };
})();
</script>`;
}
