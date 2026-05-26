// Extended `--help` copy for the CLI. Kept here (not inline in index.ts) so the
// text stays easy to read and edit. Lines are wrapped to ~78 cols so they sit
// well in a standard terminal. Commander prints these verbatim after the
// auto-generated options block.

export const ROOT_HELP = `
Examples:
  $ npx agent-emulate                      Start every service (ports 4000+)
  $ npx agent-emulate -s github,stripe     Start only the listed services
  $ npx agent-emulate --seed ./seed.yaml   Start from a specific seed file
  $ npx agent-emulate --portless           Serve over HTTPS via *.emulate hosts
  $ npx agent-emulate init                 Write a starter emulate.config.yaml
  $ npx agent-emulate list                 Show services and their endpoints

Seeding data:
  Every service loads its data from a top-level key named after the service
  (github:, stripe:, nango:, ...) in a YAML or JSON config. Field shapes mirror
  each provider's real API, so client code transfers cleanly to production.

    1. Scaffold   npx agent-emulate init            # all services
                  npx agent-emulate init -s stripe  # just one
    2. Edit       open emulate.config.yaml and add or change entries
    3. Run        npx agent-emulate                 # auto-loads the config
                  npx agent-emulate --seed other.yaml

  Add a provider you did not scaffold by adding its key; extend one you already
  have by adding entries under it, e.g.:

    stripe:
      customers:
        - { email: jane@acme.test, name: Jane Doe }
      products:
        - { name: Pro Plan }

  State is in-memory and resets on restart. (The deployable server in
  apps/server can persist it with --snapshot-file.)

Auth & base URLs:
  Default bearer token is "test_token_admin"; define your own under a top-level
  "tokens:" key. Services listen on consecutive ports from --port (default
  4000); point each SDK's base URL at the address printed on start, or remap it
  with --base-url / --portless.

Live activity (make the emulator change over time):
  A seeded emulator only answers what you gave it. To stream new activity into
  it (incoming emails, new issues, settled payments), drive it with the
  simulator CLI from @emulators/simulator:

    $ npx agent-emulate-sim run scenario.yaml --base http://localhost:4000
        --once             one tick per stream, then exit
        --dry-run          generate and log only, make no HTTP calls
        --duration <sec>   stop after N seconds

  A scenario is a YAML file describing streams (inbox emails, chat messages,
  GitHub issues, Stripe payments, ...). The simulator package ships runnable
  examples.

Inspect:
  The deployable server (apps/server) serves an aggregate inspector UI at
  /_inspector and a live SSE feed of every request at /_activity/stream.

Docs:  https://github.com/Vinniai/agent-emulate
`;

export const START_HELP = `
Examples:
  $ npx agent-emulate                      All services, ports 4000+
  $ npx agent-emulate -s github            Just GitHub on the base port
  $ npx agent-emulate -s github,stripe -p 5000
  $ npx agent-emulate --seed ./my.yaml     Load a specific config file
  $ npx agent-emulate --base-url https://{service}.local
  $ npx agent-emulate --portless           HTTPS via auto-registered aliases

Notes:
  With no --service, the services to run are inferred from the keys present in
  the config; with no config, all services start. Each service gets the next
  port up from --port; pin one with a "port:" field under its config key.
  Auto-loaded config files (first match wins): emulate.config.{yaml,yml,json}
  or service-emulator.config.{yaml,yml,json}.
`;

export const INIT_HELP = `
Examples:
  $ npx agent-emulate init                 Starter config for all services
  $ npx agent-emulate init -s nango        Just the nango: block

Writes emulate.config.yaml in the current directory (it will not overwrite an
existing file). Edit the generated keys to seed users, repos, records and the
like, then start with "npx agent-emulate".
`;

export const LIST_HELP = `
Run "npx agent-emulate init" to scaffold a config for a service, or
"npx agent-emulate -s <name>" to start just one.
`;
