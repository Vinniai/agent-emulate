// Per-provider visual themes for emulated login / consent screens.
//
// Each theme makes an emulator's auth pages resemble the real provider's look
// (palette, font, corner radius) so downstream apps see a familiar sign-in
// surface. The agent-emulate watermark bar + "EMULATED" badge (see ui.ts) are
// always overlaid on top so an emulated page is never mistaken for the real one.
//
// Tokens are derived from `npx brandmd <provider-login-url>` extractions stored
// under documentation/provider-designs/<slug>/. See sources.json for the URLs.

export interface EmuTheme {
  slug: string;
  name: string;
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  font: string;
  radius: string;
}

// The original terminal-green look. Used for the root/unknown service and any
// non-login page, so default behaviour is unchanged.
export const DEFAULT_THEME: EmuTheme = {
  slug: "default",
  name: "Emulator",
  scheme: "dark",
  bg: "#000000",
  surface: "#000000",
  border: "#0a3300",
  text: "#33ff00",
  muted: "#1a8c00",
  accent: "#33ff00",
  accentText: "#000000",
  font: "'Geist',-apple-system,BlinkMacSystemFont,sans-serif",
  radius: "8px",
};

export const THEMES: Record<string, EmuTheme> = {
  google: {
    slug: "google",
    name: "Google",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#dadce0",
    text: "#202124",
    muted: "#5f6368",
    accent: "#1a73e8",
    accentText: "#ffffff",
    font: "'Google Sans',Roboto,Arial,sans-serif",
    radius: "4px",
  },
  microsoft: {
    slug: "microsoft",
    name: "Microsoft",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#d1d1d1",
    text: "#1b1b1b",
    muted: "#605e5c",
    accent: "#0067b8",
    accentText: "#ffffff",
    font: "'Segoe UI',-apple-system,sans-serif",
    radius: "2px",
  },
  apple: {
    slug: "apple",
    name: "Apple",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#d2d2d7",
    text: "#1d1d1f",
    muted: "#6e6e73",
    accent: "#0066cc",
    accentText: "#ffffff",
    font: "-apple-system,'SF Pro Text',Helvetica,sans-serif",
    radius: "12px",
  },
  github: {
    slug: "github",
    name: "GitHub",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#d1d9e0",
    text: "#1f2328",
    muted: "#59636e",
    accent: "#1f883d",
    accentText: "#ffffff",
    font: "-apple-system,'Mona Sans','Segoe UI',Helvetica,sans-serif",
    radius: "6px",
  },
  okta: {
    slug: "okta",
    name: "Okta",
    scheme: "light",
    bg: "#f9f9f9",
    surface: "#ffffff",
    border: "#e1e1e1",
    text: "#1d1d21",
    muted: "#6e6e78",
    accent: "#3f59e4",
    accentText: "#ffffff",
    font: "'Aeonik',-apple-system,sans-serif",
    radius: "4px",
  },
  slack: {
    slug: "slack",
    name: "Slack",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#dddddd",
    text: "#1d1c1d",
    muted: "#616061",
    accent: "#4a154b",
    accentText: "#ffffff",
    font: "Lato,-apple-system,sans-serif",
    radius: "8px",
  },
  salesforce: {
    slug: "salesforce",
    name: "Salesforce",
    scheme: "light",
    bg: "#f4f6f9",
    surface: "#ffffff",
    border: "#c9c9c9",
    text: "#080707",
    muted: "#54698d",
    accent: "#0070d2",
    accentText: "#ffffff",
    font: "'Salesforce Sans',-apple-system,sans-serif",
    radius: "4px",
  },
  workos: {
    slug: "workos",
    name: "WorkOS",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#e4e4e7",
    text: "#18181b",
    muted: "#6b7280",
    accent: "#6363f1",
    accentText: "#ffffff",
    font: "'Inter',-apple-system,sans-serif",
    radius: "8px",
  },
  clerk: {
    slug: "clerk",
    name: "Clerk",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#eeeef0",
    text: "#212126",
    muted: "#747686",
    accent: "#6c47ff",
    accentText: "#ffffff",
    font: "'Inter',-apple-system,sans-serif",
    radius: "8px",
  },
  hubspot: {
    slug: "hubspot",
    name: "HubSpot",
    scheme: "light",
    bg: "#f5f8fa",
    surface: "#ffffff",
    border: "#cbd6e2",
    text: "#33475b",
    muted: "#516f90",
    accent: "#ff7a59",
    accentText: "#ffffff",
    font: "'Lexend Deca',-apple-system,sans-serif",
    radius: "6px",
  },
  stripe: {
    slug: "stripe",
    name: "Stripe",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#e6e6e6",
    text: "#1a1f36",
    muted: "#697386",
    accent: "#635bff",
    accentText: "#ffffff",
    font: "-apple-system,'Helvetica Neue',sans-serif",
    radius: "8px",
  },
  vercel: {
    slug: "vercel",
    name: "Vercel",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#eaeaea",
    text: "#171717",
    muted: "#888888",
    accent: "#171717",
    accentText: "#ffffff",
    font: "'Geist',-apple-system,sans-serif",
    radius: "6px",
  },
  resend: {
    slug: "resend",
    name: "Resend",
    scheme: "dark",
    bg: "#000000",
    surface: "#0c0c0c",
    border: "#262626",
    text: "#fafafa",
    muted: "#a3a3a3",
    accent: "#ffffff",
    accentText: "#000000",
    font: "-apple-system,'Inter',sans-serif",
    radius: "8px",
  },
  nango: {
    slug: "nango",
    name: "Nango",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#e5e7eb",
    text: "#111827",
    muted: "#6b7280",
    accent: "#467df4",
    accentText: "#ffffff",
    font: "'Inter',-apple-system,sans-serif",
    radius: "8px",
  },
  simpro: {
    slug: "simpro",
    name: "Simpro",
    scheme: "light",
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#dde3ea",
    text: "#1f2d3d",
    muted: "#5b6b7b",
    accent: "#0a8a3f",
    accentText: "#ffffff",
    font: "-apple-system,'Open Sans',sans-serif",
    radius: "4px",
  },
};

export function getTheme(service?: string): EmuTheme {
  if (!service) return DEFAULT_THEME;
  return THEMES[service.toLowerCase()] ?? DEFAULT_THEME;
}

/**
 * CSS that overrides the base (terminal-green) stylesheet so the login/consent
 * card adopts the provider's palette. Returns "" for the default theme so
 * unthemed pages render exactly as before.
 */
export function themeOverrideCss(theme: EmuTheme): string {
  if (theme.slug === "default") return "";
  return `
body{background:${theme.bg};color:${theme.text};font-family:${theme.font};}
.emu-bar{background:${theme.scheme === "dark" ? "#000" : "#1b1b1f"};border-bottom-color:rgba(255,255,255,.08);color:#ffd166;}
.emu-bar-title{color:#fff;font-family:${theme.font};}
.emu-bar-links a{color:#bdbdbd;}
.emu-bar-links a:hover{color:#fff;}
.content-inner{background:${theme.surface};border:1px solid ${theme.border};border-radius:${theme.radius};padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
.card-title{color:${theme.text};font-family:${theme.font};font-weight:600;}
.card-subtitle{color:${theme.muted};}
.user-btn{background:${theme.surface};border:1px solid ${theme.border};color:${theme.text};border-radius:${theme.radius};}
.user-btn:hover{border-color:${theme.accent};background:${theme.scheme === "dark" ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.02)"};}
.avatar{background:${theme.accent};color:${theme.accentText};font-family:${theme.font};}
.user-login{color:${theme.text};}
.user-meta{color:${theme.muted};}
.user-email{color:${theme.muted};opacity:.8;}
.powered-by{color:${theme.muted};}
.powered-by a{color:${theme.accent};}
.error-title{font-family:${theme.font};}
.error-msg{color:${theme.muted};}
`.trim();
}
