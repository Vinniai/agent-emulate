#!/usr/bin/env node
// Standalone dev runner for @emulators/uptick — bypasses emulate CLI build
// Usage: node run-dev.mjs [--port 4006] [--config path/to/emulate.config.yaml]
import { serve as createServer } from "@hono/node-server";
import { Hono } from "hono";
import { Store } from "@emulators/core";
import { uptickPlugin, seedFromConfig } from "./dist/index.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : (parseInt(process.env.PORT ?? "4006", 10));
const configIdx = args.indexOf("--config");
const configPath = configIdx >= 0 ? resolve(process.cwd(), args[configIdx + 1]) : null;

const app = new Hono();
const store = new Store();

// Middleware: require Authorization header on /api/* routes (skip OAuth token endpoint)
app.use("/api/*", async (c, next) => {
  // Allow token endpoint without auth
  if (c.req.path === "/api/oauth2/token/") return next();
  const auth = c.req.header("Authorization");
  if (!auth) {
    return c.json({ errors: [{ status: "401", title: "Unauthorized" }] }, 401);
  }
  await next();
});

// Register uptick routes
const noop = () => {};
uptickPlugin.register(app, store, { dispatch: noop }, `http://localhost:${port}`);

// Seed from config if provided
if (configPath && existsSync(configPath)) {
  const { parse } = await import("yaml");
  const yaml = readFileSync(configPath, "utf-8");
  const config = parse(yaml);
  if (config.uptick) {
    seedFromConfig(store, `http://localhost:${port}`, config.uptick);
    console.log(`✓ Seeded from ${configPath}`);
  } else {
    console.warn(`⚠ No 'uptick:' section found in ${configPath}`);
  }
} else {
  // Minimal default seed
  const { getUptickStore } = await import("./dist/index.js");
  const us = getUptickStore(store);
  us.assetTypes.insert({ name: "Fire Hose Reel", description: "" });
  us.assetTypes.insert({ name: "Fire Extinguisher", description: "" });
  us.clients.insert({
    name: "Demo Property Group",
    is_active: true,
    sector: "",
    ref: "",
    contact_name: "Demo Contact",
    contact_email: "admin@agent-emulate.dev",
  });
  console.log("✓ Seeded default data");
}

createServer({ fetch: app.fetch, port }, () => {
  console.log(`\n🔧 Uptick emulator running at http://localhost:${port}/`);
  console.log(`   Inspector: http://localhost:${port}/`);
  console.log(`   API base:  http://localhost:${port}/api/v2.15/\n`);
});
