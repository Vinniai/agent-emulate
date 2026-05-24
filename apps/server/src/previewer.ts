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

const PAGE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#000;color:#33ff00;min-height:100vh;-webkit-font-smoothing:antialiased;}
.top{border-bottom:1px solid #0a3300;padding:18px 24px;}
.top h1{font-size:1.25rem;font-weight:700;color:#33ff00;}
.top p{color:#1a8c00;font-size:.8125rem;margin-top:4px;max-width:760px;line-height:1.5;}
.top .badge{display:inline-block;background:#33ff00;color:#000;font-size:.625rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-left:8px;vertical-align:middle;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px;padding:24px;}
.card{border:1px solid #0a3300;border-radius:10px;overflow:hidden;background:#020;}
.card-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #0a3300;}
.card-head h2{font-size:1rem;font-weight:700;color:#33ff00;}
.scheme{font-size:.625rem;text-transform:uppercase;letter-spacing:.06em;color:#1a8c00;border:1px solid #0a3300;border-radius:4px;padding:1px 6px;}
.open{margin-left:auto;color:#1a8c00;font-size:.75rem;text-decoration:none;}
.open:hover{color:#33ff00;}
.meta{padding:8px 16px 0;font-size:.6875rem;color:#1a8c00;}
.meta code{color:#33ff00;}
.swatches{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px 12px;}
.sw{display:flex;align-items:center;gap:5px;font-size:.625rem;color:#1a8c00;}
.sw-chip{width:14px;height:14px;border-radius:3px;border:1px solid #0a3300;flex-shrink:0;}
.sw-val{color:#116600;}
.frame-wrap{height:340px;overflow:hidden;border-top:1px solid #0a3300;background:#fff;position:relative;}
.frame{width:166.66%;height:566px;border:0;transform:scale(.6);transform-origin:top left;}
.foot{text-align:center;padding:20px;color:#0a3300;font-size:.6875rem;}
.foot a{color:#1a8c00;text-decoration:none;}
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
