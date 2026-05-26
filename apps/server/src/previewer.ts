import { Hono } from "hono";
import { THEMES, escapeAttr, escapeHtml, type AppEnv, type EmuTheme } from "@emulators/core";

export interface PreviewerState {
  baseUrl: string;
}

/**
 * A login that renders a themed sign-in / consent card. `path` is relative to
 * the server root (the service is mounted under `/<service>`), already carrying
 * any query params needed to reach the card rather than an error or redirect.
 */
interface LoginPreview {
  slug: string;
  label: string;
  path: string;
  /** What the card on this page demonstrates. */
  note: string;
}

const CB = encodeURIComponent("http://localhost:9999/cb");
const OAUTH_Q = `client_id=demo&redirect_uri=${CB}&response_type=code&scope=openid%20email%20profile&state=preview`;

// Login-capable emulators whose authorize/sign-in route renders a themed card.
const LOGINS: LoginPreview[] = [
  { slug: "google", label: "Google", path: "/google/o/oauth2/v2/auth", note: "OAuth2 / OIDC consent" },
  {
    slug: "microsoft",
    label: "Microsoft",
    path: "/microsoft/oauth2/v2.0/authorize",
    note: "Microsoft identity platform",
  },
  { slug: "apple", label: "Apple", path: "/apple/auth/authorize", note: "Sign in with Apple" },
  { slug: "github", label: "GitHub", path: "/github/login/oauth/authorize", note: "OAuth app authorization" },
  { slug: "okta", label: "Okta", path: `/okta/oauth2/v1/authorize?${OAUTH_Q}`, note: "Okta hosted sign-in" },
  { slug: "slack", label: "Slack", path: "/slack/oauth/v2/authorize", note: "Slack OAuth" },
  { slug: "salesforce", label: "Salesforce", path: "/salesforce/services/oauth2/authorize", note: "Salesforce OAuth" },
  {
    slug: "clerk",
    label: "Clerk",
    path: `/clerk/oauth/authorize?client_id=clerk_emulate_client&redirect_uri=${encodeURIComponent("http://localhost:3000/api/auth/callback/clerk")}&response_type=code&scope=openid`,
    note: "Clerk OAuth",
  },
  { slug: "hubspot", label: "HubSpot", path: "/hubspot/oauth/authorize", note: "HubSpot OAuth" },
  { slug: "vercel", label: "Vercel", path: "/vercel/oauth/authorize", note: "Vercel OAuth" },
  {
    slug: "workos",
    label: "WorkOS",
    path: `/workos/user_management/authorize?${OAUTH_Q}&prompt=select_account`,
    note: "WorkOS AuthKit picker",
  },
];

function swatch(label: string, color: string): string {
  return `<div class="sw"><span class="sw-chip" style="background:${escapeAttr(color)}"></span><span class="sw-label">${escapeHtml(label)}</span><span class="sw-val">${escapeHtml(color)}</span></div>`;
}

function card(login: LoginPreview, theme: EmuTheme, src: string): string {
  const swatches = [
    swatch("bg", theme.bg),
    swatch("surface", theme.surface),
    swatch("accent", theme.accent),
    swatch("text", theme.text),
  ].join("");

  return `<section class="card">
  <header class="card-head">
    <h2>${escapeHtml(login.label)}</h2>
    <span class="scheme">${escapeHtml(theme.scheme)}</span>
    <a class="open" href="${escapeAttr(src)}" target="_blank" rel="noopener">Open login ↗</a>
  </header>
  <div class="meta">${escapeHtml(login.note)} · <code>${escapeHtml(theme.font.split(",")[0].replace(/['"]/g, ""))}</code> · radius <code>${escapeHtml(theme.radius)}</code></div>
  <div class="swatches">${swatches}</div>
  <div class="frame-wrap">
    <iframe class="frame" src="${escapeAttr(src)}" loading="lazy" title="${escapeAttr(login.label)} emulated login"></iframe>
  </div>
</section>`;
}

// ElevenLabs UI neutral-dark tokens (OKLCH), mirroring @emulators/core ui.ts so
// the previewer matches the rest of the control plane. The iframe wells stay
// light — they render real provider login pages, which is the point.
const PAGE_CSS = `
@font-face{
  font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;
  src:url('/_emulate/fonts/geist-sans.woff2') format('woff2');
}
:root{
  color-scheme:dark;
  --bg:oklch(0.145 0 0);--fg:oklch(0.985 0 0);--card:oklch(0.205 0 0);
  --elevated:oklch(0.269 0 0);--muted-fg:oklch(0.708 0 0);--faint-fg:oklch(0.556 0 0);
  --border:oklch(1 0 0 / 10%);--border-strong:oklch(1 0 0 / 16%);
  --primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);
  --radius:0.625rem;--radius-sm:0.375rem;
  --font-sans:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --font-mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-sans);background:var(--bg);color:var(--fg);min-height:100vh;line-height:1.55;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
.top{border-bottom:1px solid var(--border);padding:1.5rem 1.5rem;}
.top h1{font-size:1.5rem;font-weight:600;color:var(--fg);letter-spacing:-0.02em;}
.top p{color:var(--muted-fg);font-size:.875rem;margin-top:.5rem;max-width:70ch;line-height:1.6;}
.top p code{font-family:var(--font-mono);color:var(--fg);font-size:.8125rem;}
.top .badge{display:inline-flex;align-items:center;gap:.25rem;background:var(--primary);color:var(--primary-fg);font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 10px;border-radius:999px;margin-left:.5rem;vertical-align:middle;}
.top .badge::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:1.5rem;padding:1.5rem;}
.card{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--card);}
.card-head{display:flex;align-items:center;gap:.625rem;padding:.875rem 1rem;border-bottom:1px solid var(--border);}
.card-head h2{font-size:1rem;font-weight:600;color:var(--fg);letter-spacing:-0.01em;}
.scheme{font-size:.6875rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-fg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1px 7px;}
.open{margin-left:auto;color:var(--muted-fg);font-size:.8125rem;text-decoration:none;transition:color .15s;}
.open:hover{color:var(--fg);}
.meta{padding:.625rem 1rem 0;font-size:.75rem;color:var(--muted-fg);}
.meta code{font-family:var(--font-mono);color:var(--fg);}
.swatches{display:flex;flex-wrap:wrap;gap:.625rem;padding:.75rem 1rem 1rem;}
.sw{display:flex;align-items:center;gap:.375rem;font-size:.6875rem;color:var(--muted-fg);}
.sw-chip{width:14px;height:14px;border-radius:var(--radius-sm);border:1px solid var(--border-strong);flex-shrink:0;}
.sw-val{font-family:var(--font-mono);color:var(--faint-fg);}
.frame-wrap{height:340px;overflow:hidden;border-top:1px solid var(--border);background:#fff;position:relative;}
.frame{width:166.66%;height:566px;border:0;transform:scale(.6);transform-origin:top left;}
.foot{text-align:center;padding:1.5rem;color:var(--faint-fg);font-size:.75rem;}
.foot a{color:var(--muted-fg);text-decoration:none;transition:color .15s;}
.foot a:hover{color:var(--fg);}
`;

export function createPreviewerRouter(state: PreviewerState): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/_previewer", (c) => {
    const cards = LOGINS.map((login) => {
      const theme = THEMES[login.slug];
      if (!theme) return "";
      const src = `${state.baseUrl}${login.path}`;
      return card(login, theme, src);
    }).join("\n");

    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Provider login previewer | agent-emulate</title>
<style>${PAGE_CSS}</style>
</head><body>
<div class="top">
  <h1>Provider Login Previewer<span class="badge">Emulated</span></h1>
  <p>Every emulated sign-in screen below is styled from its real provider's design tokens
     (extracted with <code>brandmd</code>) and overlaid with an unmistakable agent-emulate
     watermark so it is never mistaken for the real thing. Frames are live — they render the
     same pages your apps hit during an OAuth flow.</p>
</div>
<div class="grid">
${cards}
</div>
<div class="foot">agent-emulate · <a href="https://github.com/Vinniai/agent-emulate#readme" target="_blank" rel="noopener">docs</a></div>
</body></html>`;

    return c.html(html);
  });

  return r;
}
