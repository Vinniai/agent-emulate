# Provider login designs

Reference design tokens for the **provider-styled login / consent screens** that
agent-emulate renders. Each emulated sign-in page is themed to resemble the real
provider (palette, font, corner radius) and overlaid with an unmistakable
**agent-emulate watermark** (an "Emulated" badge in the top bar plus a fixed
corner watermark) so an emulated page is never mistaken for the real thing.

## Layout

```
provider-designs/
  sources.json          # provider -> real login/auth URL used for extraction
  <slug>/
    DESIGN.md           # human-readable brand guide (brandmd output)
    tokens.json         # raw extracted design tokens (brandmd --json)
```

## Pipeline

1. **Extract** real provider design tokens with [`brandmd`](https://www.npmjs.com/package/brandmd):

   ```bash
   npx brandmd https://accounts.google.com -o documentation/provider-designs/google/DESIGN.md
   npx brandmd https://accounts.google.com --json > documentation/provider-designs/google/tokens.json
   ```

   The login URLs per provider are in [`sources.json`](./sources.json).

2. **Curate** the extracted tokens into the theme registry at
   `packages/@emulators/core/src/themes.ts` (`THEMES`). Login pages often differ
   from marketing homepages, so values are reviewed against the real sign-in
   screen, not just whatever `brandmd` captured above the fold.

3. **Apply** — `renderCardPage` / `renderErrorPage` / etc. in `core/src/ui.ts`
   look up the theme by service label and inject an additive CSS override on top
   of the default terminal-green base. Unknown / non-login pages keep the
   default look unchanged.

4. **Preview** — the running server serves a live gallery at `/_previewer`
   showing every themed login in an iframe alongside its brand-token swatches.

## Coverage

Extracted via brandmd: google, microsoft, apple, github, okta, slack,
salesforce, workos, clerk, hubspot, stripe, vercel, resend, nango.

Curated (extraction blocked by bot protection): simpro — see its `DESIGN.md`.

Themed and shown in `/_previewer`: google, microsoft, apple, github, okta,
slack, salesforce, clerk, hubspot, vercel, workos (the emulators that render a
themed sign-in / consent card).
