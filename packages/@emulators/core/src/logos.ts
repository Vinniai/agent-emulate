// Inline SVG brand marks for the provider-styled login screens.
//
// These let an emulated sign-in page show the provider's logo at the top of the
// card (the way the real screens do, e.g. accounts.google.com/v3/signin). They
// are self-contained inline SVGs — no network fetch, no external assets — so the
// pages render identically offline. The agent-emulate watermark + "Emulated"
// badge (see ui.ts) remain overlaid so a page is never mistaken for the real one.
//
// Keyed by the lower-cased service label (matching THEMES in themes.ts).

const google = `<svg viewBox="0 0 48 48" width="42" height="42" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

const microsoft = `<svg viewBox="0 0 23 23" width="36" height="36" aria-hidden="true"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>`;

const apple = `<svg viewBox="0 0 24 24" width="40" height="40" fill="#000" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`;

const github = `<svg viewBox="0 0 24 24" width="40" height="40" fill="#1f2328" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;

const okta = `<svg viewBox="0 0 24 24" width="38" height="38" fill="#00297a" aria-hidden="true"><path d="M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0zm0 18c-3.309 0-6-2.691-6-6s2.691-6 6-6 6 2.691 6 6-2.691 6-6 6z"/></svg>`;

const slack = `<svg viewBox="0 0 122.8 122.8" width="36" height="36" aria-hidden="true"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#36C5F0"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#2EB67D"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#ECB22E"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#E01E5A"/></svg>`;

const salesforce = `<svg viewBox="0 0 24 24" width="46" height="46" fill="#00A1E0" aria-hidden="true"><path d="M9.9 6.2c.72-.78 1.79-1.3 2.96-1.3 1.55 0 2.92.86 3.64 2.16.62-.28 1.31-.43 2.03-.43 2.3 0 4.17 1.88 4.17 4.2s-1.87 4.2-4.17 4.2c-.28 0-.56-.03-.83-.08-.62 1.11-1.81 1.86-3.17 1.86-.5 0-.98-.1-1.42-.29-.63 1.4-2.03 2.38-3.66 2.38-1.66 0-3.1-1.01-3.71-2.46-.23.05-.47.07-.71.07C1.55 16.61 0 15.04 0 13.11c0-1.29.69-2.42 1.72-3.04-.13-.39-.2-.81-.2-1.24 0-2.2 1.79-3.99 4-3.99 1.29 0 2.45.62 3.18 1.57.04-.07.08-.14.2-.21z"/></svg>`;

const hubspot = `<svg viewBox="0 0 24 24" width="40" height="40" fill="#FF7A59" aria-hidden="true"><path d="M18 7.32V5.13a1.74 1.74 0 1 0-1.16 0v2.19a5.05 5.05 0 0 0-2.4.98L7.97 3.43a1.95 1.95 0 1 0-.92 1.21l6.32 4.91a5.06 5.06 0 0 0 .08 5.71l-1.92 1.92a1.63 1.63 0 0 0-.47-.07 1.65 1.65 0 1 0 1.65 1.65 1.63 1.63 0 0 0-.07-.47l1.9-1.9a5.06 5.06 0 1 0 3.46-9.07zm-1.55 7.6a2.64 2.64 0 1 1 2.64-2.64 2.64 2.64 0 0 1-2.64 2.64z"/></svg>`;

const vercel = `<svg viewBox="0 0 24 24" width="34" height="34" fill="#000" aria-hidden="true"><path d="M12 2 24 22H0z"/></svg>`;

// Less-iconic standalone marks — clean branded app-icon tile with monogram.
const clerk = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#6C47FF"/><circle cx="20" cy="16.5" r="4.2" fill="#fff"/><path d="M13 28a7.6 7.6 0 0 1 14 0z" fill="#fff"/></svg>`;

const workos = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#6363F1"/><path d="M10 14l3 12 3-9 3 9 3-12" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><path d="M25 20a4.5 4.5 0 1 0 4.5 4.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;

export const LOGOS: Record<string, string> = {
  google,
  microsoft,
  apple,
  github,
  okta,
  slack,
  salesforce,
  hubspot,
  vercel,
  clerk,
  workos,
};

/** Inline SVG brand mark for a service, or null if none is registered. */
export function getLogo(service?: string): string | null {
  if (!service) return null;
  return LOGOS[service.toLowerCase()] ?? null;
}
