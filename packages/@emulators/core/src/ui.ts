import { getTheme, themeOverrideCss } from "./themes";
import { getLogo } from "./logos";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

// Control-plane + agent-emulate chrome styling. The palette is ElevenLabs UI's
// neutral monochrome (shadcn-derived, OKLCH) in dark — see
// https://github.com/elevenlabs/ui. Per-provider login/consent/checkout pages
// keep resembling their real provider: themes.ts `themeOverrideCss` cascades
// over these defaults (it returns "" only for the default/control-plane theme,
// which is why this stylesheet defines the control-plane look). The phosphor
// green is retired; the "Emulated" badge + watermark carry the anti-phishing
// signal now, rendered as a high-contrast near-white stamp.
const CSS = `
@font-face{
  font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;
  src:url('/_emulate/fonts/geist-sans.woff2') format('woff2');
}
:root{
  color-scheme:dark;
  /* ElevenLabs UI — neutral dark (OKLCH). Values already avoid pure #000/#fff. */
  --bg:oklch(0.145 0 0);
  --fg:oklch(0.985 0 0);
  --card:oklch(0.205 0 0);
  --elevated:oklch(0.269 0 0);
  --muted:oklch(0.269 0 0);
  --muted-fg:oklch(0.708 0 0);
  --faint-fg:oklch(0.556 0 0);
  --border:oklch(1 0 0 / 10%);
  --border-strong:oklch(1 0 0 / 16%);
  --ring:oklch(0.556 0 0);
  --primary:oklch(0.922 0 0);
  --primary-fg:oklch(0.205 0 0);
  --danger:oklch(0.704 0.191 22.216);
  --radius:0.625rem;
  --radius-sm:0.375rem;
  --radius-lg:0.875rem;
  --radius-pill:999px;
  --space-xs:0.25rem;--space-sm:0.5rem;--space-md:0.75rem;
  --space-lg:1rem;--space-xl:1.5rem;--space-2xl:2rem;--space-3xl:3rem;
  --text-xs:0.75rem;--text-sm:0.8125rem;--text-md:0.875rem;
  --text-base:1rem;--text-lg:1.25rem;--text-xl:1.5rem;
  --font-sans:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --font-mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--font-sans);font-size:var(--text-md);line-height:1.55;
  background:var(--bg);color:var(--fg);min-height:100vh;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
}
::selection{background:var(--primary);color:var(--primary-fg);}

.emu-bar{
  border-bottom:1px solid var(--border);padding:var(--space-md) var(--space-xl);
  display:flex;align-items:center;gap:var(--space-md);
  font-size:var(--text-sm);color:var(--muted-fg);
}
.emu-bar-title{font-weight:600;color:var(--fg);letter-spacing:-0.01em;}
.emu-badge{
  display:inline-flex;align-items:center;gap:var(--space-xs);
  font-size:var(--text-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  padding:3px 10px;border-radius:var(--radius-pill);
  background:var(--primary);color:var(--primary-fg);
  white-space:nowrap;flex-shrink:0;
}
.emu-badge::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;}
.emu-watermark{
  position:fixed;bottom:var(--space-lg);right:var(--space-lg);z-index:9999;pointer-events:none;
  font-size:var(--text-xs);font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  padding:5px 11px;border-radius:var(--radius-sm);
  background:color-mix(in oklch,var(--bg) 72%,transparent);
  color:var(--muted-fg);border:1px solid var(--border-strong);
  backdrop-filter:blur(6px);
}
.emu-bar-links{margin-left:auto;display:flex;gap:var(--space-xl);}
.emu-bar-links a{
  color:var(--muted-fg);font-size:var(--text-sm);text-decoration:none;transition:color .15s;
}
.emu-bar-links a:hover{color:var(--fg);}
.emu-bar-links a .full{display:inline;}
.emu-bar-links a .short{display:none;}
@media(max-width:600px){
  .emu-bar-links a .full{display:none;}
  .emu-bar-links a .short{display:inline;}
}

.content{
  display:flex;align-items:center;justify-content:center;
  min-height:calc(100vh - 50px);padding:var(--space-2xl) var(--space-lg);
}
.content-inner{width:100%;max-width:420px;}
.brand-logo{display:flex;justify-content:center;margin-bottom:var(--space-xl);}
.brand-logo svg{display:block;}
.card-branded{text-align:center;}
.card-branded .card-title{text-align:center;}
.card-branded .card-subtitle{text-align:center;}
.card-branded .user-form{text-align:left;}
.card-title{
  font-size:var(--text-lg);font-weight:600;letter-spacing:-0.02em;
  margin-bottom:var(--space-xs);color:var(--fg);
}
.card-subtitle{color:var(--muted-fg);font-size:var(--text-sm);margin-bottom:var(--space-xl);line-height:1.5;}
.powered-by{
  position:fixed;bottom:0;left:0;right:0;
  text-align:center;padding:var(--space-md);font-size:var(--text-xs);color:var(--faint-fg);
}
.powered-by a{color:var(--muted-fg);text-decoration:none;transition:color .15s;}
.powered-by a:hover{color:var(--fg);}

.error-title{color:var(--danger);font-size:var(--text-lg);font-weight:600;margin-bottom:var(--space-sm);letter-spacing:-0.01em;}
.error-msg{color:var(--muted-fg);font-size:var(--text-md);line-height:1.5;}
.error-card{text-align:center;}

.user-form{margin-bottom:var(--space-sm);}
.user-form:last-of-type{margin-bottom:0;}
.user-btn{
  width:100%;display:flex;align-items:center;gap:var(--space-md);
  padding:var(--space-md);border:1px solid var(--border);border-radius:var(--radius);
  background:var(--card);color:inherit;cursor:pointer;text-align:left;
  font:inherit;transition:border-color .15s,background .15s;
}
.user-btn:hover{border-color:var(--border-strong);background:var(--elevated);}
.avatar{
  width:36px;height:36px;border-radius:50%;
  background:var(--elevated);color:var(--fg);font-weight:600;font-size:var(--text-md);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.user-text{min-width:0;}
.user-login{font-weight:600;font-size:var(--text-md);display:block;color:var(--fg);}
.user-meta{color:var(--muted-fg);font-size:var(--text-xs);margin-top:1px;}
.user-email{font-size:var(--text-xs);color:var(--faint-fg);word-break:break-all;margin-top:1px;}

.settings-layout{
  max-width:920px;margin:0 auto;padding:var(--space-3xl) var(--space-xl);
  display:flex;gap:var(--space-3xl);
}
.settings-sidebar{width:200px;flex-shrink:0;}
.settings-sidebar a{
  display:block;padding:6px 10px;border-radius:var(--radius-sm);color:var(--muted-fg);
  text-decoration:none;font-size:var(--text-sm);transition:color .15s,background .15s;
}
.settings-sidebar a:hover{color:var(--fg);background:var(--muted);}
.settings-sidebar a.active{color:var(--fg);font-weight:600;background:var(--muted);}
.settings-main{flex:1;min-width:0;}

.s-card{
  padding:var(--space-xl) 0;margin-bottom:var(--space-lg);border-bottom:1px solid var(--border);
}
.s-card:last-child{border-bottom:none;}
.s-card-header{display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);}
.s-icon{
  width:40px;height:40px;border-radius:var(--radius);
  background:var(--elevated);display:flex;align-items:center;justify-content:center;
  font-size:var(--text-base);font-weight:600;color:var(--muted-fg);flex-shrink:0;
}
.s-title{font-size:var(--text-lg);font-weight:600;color:var(--fg);letter-spacing:-0.01em;}
.s-subtitle{font-size:var(--text-xs);color:var(--muted-fg);margin-top:2px;}
.section-heading{
  font-size:var(--text-md);font-weight:600;margin-bottom:var(--space-md);color:var(--fg);
  display:flex;align-items:center;justify-content:space-between;
}
.perm-list{list-style:none;}
.perm-list li{padding:5px 0;font-size:var(--text-sm);display:flex;align-items:center;gap:var(--space-sm);color:var(--muted-fg);}
.check{color:var(--fg);}
.org-row{
  display:flex;align-items:center;gap:var(--space-sm);padding:7px 0;
  border-bottom:1px solid var(--border);font-size:var(--text-sm);
}
.org-row:last-child{border-bottom:none;}
.org-icon{
  width:22px;height:22px;border-radius:var(--radius-sm);background:var(--elevated);
  display:flex;align-items:center;justify-content:center;
  font-size:var(--text-xs);font-weight:600;color:var(--muted-fg);flex-shrink:0;
}
.org-name{font-weight:600;color:var(--fg);}
.badge{
  font-size:var(--text-xs);padding:2px 8px;border-radius:var(--radius-sm);font-weight:500;
  background:var(--muted);color:var(--muted-fg);border:1px solid var(--border);
}
.badge-granted{background:var(--elevated);color:var(--fg);}
.badge-denied{background:color-mix(in oklch,var(--danger) 18%,var(--bg));color:var(--danger);border-color:color-mix(in oklch,var(--danger) 30%,transparent);}
.badge-requested{background:var(--muted);color:var(--muted-fg);}
.btn-revoke{
  display:inline-block;padding:5px 14px;border-radius:var(--radius-sm);
  border:1px solid var(--border);background:transparent;color:var(--danger);
  font-size:var(--text-xs);font-weight:600;cursor:pointer;transition:border-color .15s;
}
.btn-revoke:hover{border-color:var(--danger);}
.info-text{color:var(--muted-fg);font-size:var(--text-xs);line-height:1.5;margin-top:var(--space-md);}
.app-link{
  display:flex;align-items:center;gap:var(--space-md);padding:var(--space-md);
  border:1px solid var(--border);border-radius:var(--radius);background:var(--card);
  text-decoration:none;color:inherit;margin-bottom:var(--space-sm);transition:border-color .15s,background .15s;
}
.app-link:hover{border-color:var(--border-strong);background:var(--elevated);}
.app-link-name{font-weight:600;font-size:var(--text-md);color:var(--fg);}
.app-link-scopes{font-size:var(--text-xs);color:var(--muted-fg);margin-top:1px;}
.empty{color:var(--muted-fg);text-align:center;padding:var(--space-3xl) 0;font-size:var(--text-md);}

.inspector-layout{max-width:960px;margin:0 auto;padding:var(--space-3xl) var(--space-xl);}
.inspector-tabs{
  display:flex;flex-wrap:wrap;gap:var(--space-xs);margin-bottom:var(--space-2xl);
  padding:var(--space-xs);background:var(--card);border:1px solid var(--border);
  border-radius:var(--radius);width:fit-content;max-width:100%;
}
.inspector-tabs a{
  padding:6px 14px;border-radius:var(--radius-sm);text-decoration:none;
  font-size:var(--text-sm);color:var(--muted-fg);transition:color .15s,background .15s;
}
.inspector-tabs a:hover{color:var(--fg);}
.inspector-tabs a.active{color:var(--fg);font-weight:600;background:var(--elevated);}
.inspector-section{margin-bottom:var(--space-2xl);}
.inspector-section h2{
  font-size:var(--text-lg);font-weight:600;color:var(--fg);
  margin-bottom:var(--space-md);letter-spacing:-0.01em;
}
.inspector-section h3{
  font-size:var(--text-md);font-weight:600;color:var(--muted-fg);
  margin:var(--space-xl) 0 var(--space-sm);
}
.inspector-table{width:100%;border-collapse:collapse;margin-bottom:var(--space-md);}
.inspector-table th,.inspector-table td{
  text-align:left;padding:var(--space-sm) var(--space-md);border-bottom:1px solid var(--border);
  font-size:var(--text-sm);
}
.inspector-table th{color:var(--faint-fg);font-weight:600;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;}
.inspector-table td{color:var(--fg);}
.inspector-table tbody tr{transition:background .12s;}
.inspector-table tbody tr:hover{background:var(--card);}
.inspector-empty{color:var(--muted-fg);text-align:center;padding:var(--space-xl) 0;font-size:var(--text-sm);}

/* Live activity feed (renderActivityCard) — token-driven so it stays cohesive
   with the dark control plane instead of the old hard-coded light values. */
.act-pulse{
  width:9px;height:9px;border-radius:50%;background:var(--fg);flex-shrink:0;
  position:relative;
}
.act-pulse::after{
  content:"";position:absolute;inset:-4px;border-radius:50%;
  border:1px solid var(--fg);opacity:.5;animation:act-ping 1.8s ease-out infinite;
}
@keyframes act-ping{0%{transform:scale(.6);opacity:.5}80%,100%{transform:scale(1.6);opacity:0}}
@media(prefers-reduced-motion:reduce){.act-pulse::after{animation:none;}}
.act-status.is-live{color:var(--fg);}
.act-status.is-error{color:var(--danger);}
.act-mono{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--muted-fg);white-space:nowrap;}
.act-fields{font-size:var(--text-xs);color:var(--muted-fg);}
.act-json-btn{
  font:inherit;font-size:var(--text-xs);padding:2px 9px;border:1px solid var(--border);
  border-radius:var(--radius-sm);background:transparent;color:var(--muted-fg);
  cursor:pointer;transition:border-color .15s,color .15s;
}
.act-json-btn:hover{border-color:var(--border-strong);color:var(--fg);}
.act-detail-cell{background:var(--card);padding:var(--space-sm) var(--space-md);}
.act-detail-cell pre{
  margin:0;font-family:var(--font-mono);font-size:var(--text-xs);line-height:1.5;
  color:var(--muted-fg);white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;
}
.inspector-table tbody tr.act-row-new td{background:color-mix(in oklch,var(--elevated) 80%,transparent);transition:background .9s;}

.checkout-layout{display:flex;min-height:calc(100vh - 50px);}
.checkout-summary{
  flex:1;background:var(--card);padding:var(--space-3xl) var(--space-2xl) var(--space-3xl) 10%;
  display:flex;flex-direction:column;justify-content:center;border-right:1px solid var(--border);
}
.checkout-form-side{
  flex:1;background:var(--bg);padding:var(--space-3xl) 10% var(--space-3xl) var(--space-2xl);
  display:flex;flex-direction:column;justify-content:center;
}
.checkout-merchant{display:flex;align-items:center;gap:var(--space-md);margin-bottom:6px;}
.checkout-merchant-name{font-size:var(--text-md);font-weight:600;color:var(--fg);}
.checkout-test-badge{
  font-size:var(--text-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  background:var(--muted);color:var(--muted-fg);padding:2px 8px;border-radius:var(--radius-sm);
}
.checkout-total{font-size:var(--text-xl);font-weight:700;color:var(--fg);margin:var(--space-sm) 0 var(--space-2xl);letter-spacing:-0.02em;}
.checkout-line-item{display:flex;align-items:center;gap:var(--space-md);padding:var(--space-lg) 0;border-bottom:1px solid var(--border);}
.checkout-line-item:first-child{border-top:1px solid var(--border);}
.checkout-item-icon{
  width:40px;height:40px;border-radius:var(--radius-sm);background:var(--elevated);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  font-size:var(--text-md);font-weight:600;color:var(--muted-fg);
}
.checkout-item-details{flex:1;min-width:0;}
.checkout-item-name{font-size:var(--text-md);font-weight:600;color:var(--fg);}
.checkout-item-qty{font-size:var(--text-xs);color:var(--muted-fg);margin-top:2px;}
.checkout-item-price{font-size:var(--text-md);font-weight:600;color:var(--fg);text-align:right;white-space:nowrap;}
.checkout-item-unit{font-size:var(--text-xs);color:var(--muted-fg);text-align:right;margin-top:2px;}
.checkout-totals{margin-top:var(--space-xl);}
.checkout-totals-row{display:flex;justify-content:space-between;padding:6px 0;font-size:var(--text-sm);color:var(--muted-fg);}
.checkout-totals-row.total{border-top:1px solid var(--border);margin-top:var(--space-sm);padding-top:var(--space-lg);font-size:var(--text-md);font-weight:600;color:var(--fg);}
.checkout-form-section{margin-bottom:var(--space-xl);}
.checkout-form-label{font-size:var(--text-sm);font-weight:600;color:var(--fg);margin-bottom:var(--space-sm);display:block;}
.checkout-input{
  width:100%;padding:var(--space-md);border:1px solid var(--border);border-radius:var(--radius-sm);
  background:var(--card);color:var(--fg);font:inherit;font-size:var(--text-md);
  transition:border-color .15s;outline:none;
}
.checkout-input:focus{border-color:var(--ring);}
.checkout-input::placeholder{color:var(--faint-fg);}
.checkout-card-box{border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-lg);background:var(--card);}
.checkout-card-row{display:flex;gap:var(--space-md);margin-top:var(--space-md);}
.checkout-card-row .checkout-input{flex:1;}
.checkout-sim-note{font-size:var(--text-xs);color:var(--muted-fg);margin-top:var(--space-md);text-align:center;font-style:italic;}
.checkout-pay-btn{
  width:100%;padding:var(--space-lg);border:none;border-radius:var(--radius);
  background:var(--primary);color:var(--primary-fg);font:inherit;font-size:var(--text-md);font-weight:600;
  cursor:pointer;transition:opacity .15s;
}
.checkout-pay-btn:hover{opacity:.9;}
.checkout-cancel{text-align:center;margin-top:var(--space-lg);}
.checkout-cancel a{color:var(--muted-fg);text-decoration:none;font-size:var(--text-sm);transition:color .15s;}
.checkout-cancel a:hover{color:var(--fg);}
@media(max-width:768px){
  .checkout-layout{flex-direction:column;}
  .checkout-summary{padding:var(--space-2xl) var(--space-xl);border-right:none;border-bottom:1px solid var(--border);}
  .checkout-form-side{padding:var(--space-2xl) var(--space-xl);}
}
`;

const POWERED_BY = `<div class="powered-by">Powered by <a href="https://github.com/Vinniai/agent-emulate#readme" target="_blank" rel="noopener">agent-emulate</a></div>`;

// Fixed-position watermark shown on every page so a themed (provider-styled)
// page can never be mistaken for the real provider's login.
const WATERMARK = `<div class="emu-watermark" aria-hidden="true">agent-emulate</div>`;

function emuBar(service?: string): string {
  const title = service ? `${escapeHtml(service)} Emulator` : "Emulator";
  return `<div class="emu-bar">
  <span class="emu-bar-title">${title}</span>
  <span class="emu-badge" title="This is a local emulator, not the real provider">Emulated</span>
  <nav class="emu-bar-links">
    <a href="https://github.com/Vinniai/agent-emulate/issues" target="_blank" rel="noopener"><span class="full">Report Issue</span><span class="short">Report</span></a>
    <a href="https://github.com/Vinniai/agent-emulate" target="_blank" rel="noopener"><span class="full">Source Code</span><span class="short">Source</span></a>
    <a href="https://github.com/Vinniai/agent-emulate#readme" target="_blank" rel="noopener"><span class="full">Learn More</span><span class="short">Learn</span></a>
  </nav>
</div>`;
}

function head(title: string, service?: string): string {
  const themeCss = themeOverrideCss(getTheme(service));
  const themeStyle = themeCss ? `<style>${themeCss}</style>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/_emulate/favicon.ico"/>
<title>${escapeHtml(title)} | agent-emulate</title>
<style>${CSS}</style>${themeStyle}
</head>`;
}

export function renderCardPage(title: string, subtitle: string, body: string, service?: string): string {
  const logo = getLogo(service);
  const logoHtml = logo ? `<div class="brand-logo">${logo}</div>` : "";
  return `${head(title, service)}
<body>
${emuBar(service)}
<div class="content">
  <div class="content-inner${logo ? " card-branded" : ""}">
    ${logoHtml}
    <div class="card-title">${escapeHtml(title)}</div>
    <div class="card-subtitle">${subtitle}</div>
    ${body}
  </div>
</div>
${POWERED_BY}
${WATERMARK}
</body></html>`;
}

export function renderErrorPage(title: string, message: string, service?: string): string {
  const logo = getLogo(service);
  const logoHtml = logo ? `<div class="brand-logo">${logo}</div>` : "";
  return `${head(title, service)}
<body>
${emuBar(service)}
<div class="content">
  <div class="content-inner error-card">
    ${logoHtml}
    <div class="error-title">${escapeHtml(title)}</div>
    <div class="error-msg">${escapeHtml(message)}</div>
  </div>
</div>
${POWERED_BY}
${WATERMARK}
</body></html>`;
}

export function renderSettingsPage(title: string, sidebarHtml: string, bodyHtml: string, service?: string): string {
  return `${head(title, service)}
<body>
${emuBar(service)}
<div class="settings-layout">
  <nav class="settings-sidebar">${sidebarHtml}</nav>
  <div class="settings-main">${bodyHtml}</div>
</div>
${POWERED_BY}
${WATERMARK}
</body></html>`;
}

export interface InspectorTab {
  id: string;
  label: string;
  href: string;
}

export function renderInspectorPage(
  title: string,
  tabs: InspectorTab[],
  activeTab: string,
  body: string,
  service?: string,
): string {
  const tabLinks = tabs
    .map(
      (t) => `<a href="${escapeAttr(t.href)}" class="${t.id === activeTab ? "active" : ""}">${escapeHtml(t.label)}</a>`,
    )
    .join("");

  return `${head(title, service)}
<body>
${emuBar(service)}
<div class="inspector-layout">
  <nav class="inspector-tabs">${tabLinks}</nav>
  ${body}
</div>
${POWERED_BY}
${WATERMARK}
</body></html>`;
}

export function renderFormPostPage(action: string, fields: Record<string, string>, service?: string): string {
  const hiddens = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}"/>`)
    .join("\n");

  return `${head("Redirecting", service)}
<body onload="document.forms[0].submit()">
${emuBar(service)}
<div class="content">
  <div class="content-inner" style="text-align:center">
    <div class="card-subtitle">Redirecting&hellip;</div>
    <form method="POST" action="${escapeAttr(action)}">
${hiddens}
    <noscript><button type="submit" class="user-btn" style="margin-top:12px;justify-content:center">
      <span class="user-login">Continue</span>
    </button></noscript>
    </form>
  </div>
</div>
${POWERED_BY}
${WATERMARK}
</body></html>`;
}

export interface CheckoutLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
}

export interface CheckoutPageOptions {
  merchantName?: string;
  lineItems: CheckoutLineItem[];
  subtotal: number;
  total: number;
  currency: string;
  sessionId: string;
  cancelUrl?: string | null;
}

export function renderCheckoutPage(opts: CheckoutPageOptions, service?: string): string {
  const fmt = (cents: number, cur: string) => `$${(cents / 100).toFixed(2)} ${cur.toUpperCase()}`;
  const fmtShort = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const itemsHtml =
    opts.lineItems.length > 0
      ? opts.lineItems
          .map((li) => {
            const initial = li.name.charAt(0).toUpperCase();
            const unitNote =
              li.quantity > 1 ? `<div class="checkout-item-unit">${fmtShort(li.unitPrice)} each</div>` : "";
            return `<div class="checkout-line-item">
  <div class="checkout-item-icon">${escapeHtml(initial)}</div>
  <div class="checkout-item-details">
    <div class="checkout-item-name">${escapeHtml(li.name)}</div>
    <div class="checkout-item-qty">Qty ${li.quantity}</div>
  </div>
  <div>
    <div class="checkout-item-price">${fmtShort(li.totalPrice)}</div>
    ${unitNote}
  </div>
</div>`;
          })
          .join("")
      : '<p class="empty">No line items</p>';

  const totalsHtml = `<div class="checkout-totals">
  <div class="checkout-totals-row">
    <span>Subtotal</span><span>${fmtShort(opts.subtotal)}</span>
  </div>
  <div class="checkout-totals-row total">
    <span>Total due</span><span>${fmt(opts.total, opts.currency)}</span>
  </div>
</div>`;

  const cancelHtml = opts.cancelUrl
    ? `<div class="checkout-cancel"><a href="${escapeAttr(opts.cancelUrl)}">Cancel</a></div>`
    : "";

  const merchant = opts.merchantName ? escapeHtml(opts.merchantName) : "Checkout";

  return `${head("Checkout", service)}
<body>
${emuBar(service)}
<div class="checkout-layout">
  <div class="checkout-summary">
    <div class="checkout-merchant">
      <span class="checkout-merchant-name">${merchant}</span>
      <span class="checkout-test-badge">Test Mode</span>
    </div>
    <div class="checkout-total">${fmtShort(opts.total)}</div>
    ${itemsHtml}
    ${totalsHtml}
  </div>
  <div class="checkout-form-side">
    <form method="post" action="/checkout/${escapeAttr(opts.sessionId)}/complete">
      <div class="checkout-form-section">
        <label class="checkout-form-label">Email</label>
        <input type="email" name="email" class="checkout-input" placeholder="you@agent-emulate.dev"/>
      </div>
      <div class="checkout-form-section">
        <label class="checkout-form-label">Card information</label>
        <div class="checkout-card-box">
          <input type="text" class="checkout-input" placeholder="1234 1234 1234 1234" disabled/>
          <div class="checkout-card-row">
            <input type="text" class="checkout-input" placeholder="MM / YY" disabled/>
            <input type="text" class="checkout-input" placeholder="CVC" disabled/>
          </div>
        </div>
        <div class="checkout-sim-note">Card fields are simulated. Payment will be auto-approved.</div>
      </div>
      <button type="submit" class="checkout-pay-btn">Pay ${fmtShort(opts.total)}</button>
    </form>
    ${cancelHtml}
  </div>
</div>
${POWERED_BY}
${WATERMARK}
</body></html>`;
}

export interface UserButtonOptions {
  letter: string;
  login: string;
  name?: string;
  email?: string;
  formAction: string;
  hiddenFields: Record<string, string>;
}

export function renderUserButton(opts: UserButtonOptions): string {
  const hiddens = Object.entries(opts.hiddenFields)
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}"/>`)
    .join("");

  const nameLine = opts.name ? `<div class="user-meta">${escapeHtml(opts.name)}</div>` : "";
  const emailLine = opts.email ? `<div class="user-email">${escapeHtml(opts.email)}</div>` : "";

  return `<form class="user-form" method="post" action="${escapeAttr(opts.formAction)}">
${hiddens}
<button type="submit" class="user-btn">
  <span class="avatar">${escapeHtml(opts.letter)}</span>
  <span class="user-text">
    <span class="user-login">${escapeHtml(opts.login)}</span>
    ${nameLine}${emailLine}
  </span>
</button>
</form>`;
}
