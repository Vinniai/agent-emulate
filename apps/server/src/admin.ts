import { Hono } from "hono";
import { stringify as stringifyYaml } from "yaml";
import type { AppEnv } from "@emulators/core";
import { reseedApps, type ServiceApp, type ServiceName } from "./dispatcher.js";
import { expandUnifiedUsers, listUnifiedUsers, type MintedToken } from "./seed/users.js";
import type { EmulateConfig } from "./config.js";
import { SERVICE_NAMES } from "./plugins.js";

export interface AdminState {
  apps: Map<ServiceName, ServiceApp>;
  config: EmulateConfig;
  tokens: MintedToken[];
  baseUrl: string;
}

export function createAdminRouter(state: AdminState): Hono<AppEnv> {
  const admin = new Hono<AppEnv>();
  const adminToken = process.env.EMULATE_ADMIN_TOKEN;

  admin.use("*", async (c, next) => {
    if (c.req.path === "/_admin/health") return next();
    if (!adminToken) return next();
    const header = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${adminToken}`;
    if (header !== expected) return c.json({ message: "Unauthorized" }, 401);
    return next();
  });

  admin.get("/_admin/health", (c) => c.json({ status: "ok", services: [...state.apps.keys()] }));

  admin.get("/_admin/users", (c) =>
    c.json({
      users: listUnifiedUsers(state.config, state.tokens),
      tokens: state.tokens,
    }),
  );

  admin.get("/_admin/config", (c) => c.json(state.config));

  admin.post("/_admin/reset", (c) => {
    for (const sa of state.apps.values()) sa.store.reset();
    return c.json({ status: "reset", services: [...state.apps.keys()] });
  });

  const syncTokenMaps = () => {
    for (const sa of state.apps.values()) {
      sa.tokenMap.clear();
      if (state.config.tokens) {
        let id = 100;
        for (const [tok, user] of Object.entries(state.config.tokens)) {
          sa.tokenMap.set(tok, {
            login: user.login,
            id: id++,
            scopes: user.scopes ?? [],
          });
        }
      }
    }
  };

  admin.post("/_admin/seed", async (c) => {
    const mode = c.req.query("mode") === "merge" ? "merge" : "replace";
    let body: EmulateConfig;
    try {
      body = (await c.req.json()) as EmulateConfig;
    } catch {
      return c.json({ message: "Invalid JSON body" }, 400);
    }

    if (mode === "merge") {
      // Additive: layer the pushed seed onto existing store state via each
      // plugin's seedFromConfig (upsert). No store.reset(), no auth wipe —
      // live OAuth credentials and prior records survive untouched.
      //
      // Idempotency depends on the plugin's seedFromConfig:
      //   simpro / nango — fully upsert-safe
      //   google         — calendars / calendar_events duplicate on repeat
      //   microsoft      — graph arrays replaced wholesale
      //   uptick         — defects duplicate on repeat
      Object.assign(state.config, body);

      if ("tokens" in body || "users" in body) {
        state.tokens = expandUnifiedUsers(state.config);
        syncTokenMaps();
      }

      const merged: string[] = [];
      for (const name of SERVICE_NAMES) {
        const svcSeedConfig = body[name] as Record<string, unknown> | undefined;
        if (svcSeedConfig == null) continue;
        const sa = state.apps.get(name);
        if (!sa?.seedFromConfig) continue;
        sa.seedFromConfig(sa.store, `${state.baseUrl}/${name}`, svcSeedConfig);
        merged.push(name);
      }

      return c.json({
        status: "merged",
        services: merged,
        users: listUnifiedUsers(state.config, state.tokens),
      });
    }

    // replace (default) — wipe and reseed, preserving live auth credentials.
    state.config = body;
    state.tokens = expandUnifiedUsers(state.config);
    syncTokenMaps();

    const serviceConfigs: Record<string, Record<string, unknown> | undefined> = {};
    for (const name of SERVICE_NAMES) {
      serviceConfigs[name] = state.config[name] as Record<string, unknown> | undefined;
    }
    reseedApps(state.apps, serviceConfigs, state.baseUrl);

    return c.json({
      status: "seeded",
      services: [...state.apps.keys()],
      users: listUnifiedUsers(state.config, state.tokens),
    });
  });

  // Capture live store state back into an editable, re-seedable config. The
  // payload is shaped exactly like emulate.config.* and POST /_admin/seed
  // accepts it verbatim (round-trip invariant). Services without a converter
  // are listed under `_meta.export_notes` (inert on re-seed).
  admin.get("/_admin/export", (c) => {
    const svcFilter = c.req.query("service");
    const format = c.req.query("format") === "yaml" ? "yaml" : "json";
    const includeCredentials = c.req.query("includeCredentials") === "true";

    const out: Record<string, unknown> = {};
    const notes: Record<string, string> = {};

    for (const [name, sa] of state.apps) {
      if (svcFilter && name !== svcFilter) continue;
      if (!sa.storeToSeedConfig) {
        notes[name] = "no exporter — live state not captured; re-seed from original config";
        continue;
      }
      out[name] = sa.storeToSeedConfig(sa.store, `${state.baseUrl}/${name}`, { includeCredentials });
    }

    // Carry identity config through so the export is directly re-seedable.
    if (state.config.tokens) out.tokens = state.config.tokens;
    if (state.config.users) out.users = state.config.users;

    if (Object.keys(notes).length > 0) out._meta = { export_notes: notes };

    // Strip undefined keys for a clean, deterministic payload.
    const clean = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;

    if (format === "yaml") {
      return c.body(stringifyYaml(clean), 200, { "Content-Type": "application/yaml; charset=utf-8" });
    }
    return c.json(clean);
  });

  return admin;
}
