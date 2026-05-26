# Changelog

## 0.3.0

<!-- release:start -->
Developer-experience release that makes the CLI self-explanatory for agents and fixes provider-themed pages that rendered unreadable text.

### Improvements

- **Guided CLI help** — `agent-emulate --help` now walks through the whole workflow: seeding data from a `<service>:` config key, scaffolding with `init`, driving live activity with `agent-emulate-sim`, the auth and base-URL options, and where to inspect traffic. The `start`, `init` and `list` commands each carry focused examples and notes.
- **Categorized service list** — `agent-emulate list` groups services (identity & SSO, platforms & cloud, payments & messaging, integrations & field service) and prints an enable-and-seed cheat sheet, so it reads as a menu rather than a flat dump.

### Bug Fixes

- **Readable provider themes** — pages styled after a provider (Google, Vercel, Clerk, Stripe and the rest) re-skinned individual elements but left the rest of the page on the default dark palette, so light themes painted near-white text on white. Themes now redefine the underlying design-token layer, so every page (including the inspector and settings views) recolors correctly and keeps accessible contrast.
<!-- release:end -->

## 0.2.0

Minor release that fills out the WorkOS emulator into a full tenant model and lets Nango connections scope by organization, so a downstream sync can mirror orgs, users and integrations from one consistent identity.

### New Features

- **WorkOS organizations, users & memberships** — full User Management CRUD for organizations, users, organization memberships, invitations and sessions, alongside the existing AuthKit/SSO sign-in surface.
- **WorkOS lifecycle webhook events** — creating, updating or deleting through the management API now emits a WorkOS-shaped event (`organization.created`, `user.created` / `updated` / `deleted`, `organization_membership.created` / `deleted`) using the real `{ id, event, data, created_at }` envelope. Delivery is best-effort and never breaks the API call that triggered it. A new `POST /webhooks/test` endpoint delivers a signed test event with an HMAC `workos-signature` header.
- **Organization-scoped Nango connections** — connections linked through a connect session are now tagged with `organization_id` and `end_user_id`, and the connection list can be filtered server-side with `GET /connections?tags[organization_id]=<org>`. `metadata` keeps its camelCase shape for backward compatibility.

## 0.1.1

Patch release that slims the published package.

### Improvements

- **Smaller install** — the bundled Simpro Swagger spec is trimmed to the runtime-only fields the emulator reads, dropping it from about 25 MB to under 1 MB. The full 1435-operation route surface and all emulator behavior are unchanged; the `agent-emulate` tarball is now a fraction of its previous size.

## 0.1.0

Initial public release of **agent-emulate** — local, drop-in emulators for third-party APIs and OAuth providers, built for CI and no-network sandboxes.

### Highlights

- **One CLI, or embed it** — run emulators with `npx agent-emulate`, or embed them in-process (portless mode with base-URL override, no dedicated ports required).
- **OAuth & identity providers** — GitHub, Google (including the `hd` hosted-domain claim), Apple, Microsoft Entra ID, Okta, Clerk, and WorkOS.
- **SaaS & infra APIs** — AWS (S3, AWS SDK wire-compatible), MongoDB Atlas (Data API), Stripe (Checkout, customer sessions, payment methods), Resend, Slack, Vercel, Nango, and 30+ more integration emulators under `@emulators/*`.
- **Framework adapters** — `@emulators/adapter-next` for Next.js and `@emulators/msw` for Mock Service Worker, plus a live activity stream over SSE.
- **Consistent inspector UIs** — every emulator ships a shared design-system UI for inspecting traffic, gated by CI quality checks.

---

### Prior history (pre-rename)

These releases predate the rename to `agent-emulate` and are kept for reference.

## 0.5.0

### New Features

- **Clerk emulator** — local emulation of Clerk authentication and session management (#38)
- **Portless integration** — embed emulators directly in your app without dedicated ports, with base URL override support (#78)
- **Google `hd` claim** — hosted domain claim in ID tokens and userinfo for Google OAuth (#73)
- **Stripe Checkout example** — full working example of Stripe Checkout with the Stripe emulator (#82)
- **Resend magic link example** — working example of Resend magic link authentication flow (#51)
- **Docs landing page** — new landing page for the docs site (#81)

### Improvements

- **Unified UI design system** — all emulator UIs now share a consistent design system with CI quality checks (#50)
- **Stripe** — added customer sessions and payment methods API (#47)

### Bug Fixes

- Fixed **AWS S3** emulator compatibility with the official AWS SDK wire format (#65, #69)
- Fixed **Resend** email inbox links not being clickable in preview (#80)

### Contributors

- @ctate
- @disintegrator
- @jlucaso1
- @Railly
- @tmm

## 0.4.1

### Bug Fixes

- Include README in all `@emulators/*` npm packages

## 0.4.0

### New Features

- **Next.js adapter** — embed emulators directly in your Next.js app via `@emulators/adapter-next`, solving the Vercel preview deployment problem where OAuth callback URLs change with every deployment (#43)
- **MongoDB Atlas emulator** — local emulation of MongoDB Atlas with Data API support (#18)
- **Stripe emulator** — local emulation of Stripe billing and payment APIs (#4)
- **Resend emulator** — local emulation of the Resend email API (#7)
- **Okta emulator** — local emulation of Okta authentication and OIDC flows (#32)

### Improvements

- **Microsoft Entra ID** — added v1 OAuth token endpoint and Microsoft Graph `/users/{id}` route (#30)

### Bug Fixes

- Fixed multiple bugs, security hardening, and quality improvements across all emulators (#37)

### Contributors

- @AmorosoDavid12
- @ctate
- @jk4235
- @mvanhorn
