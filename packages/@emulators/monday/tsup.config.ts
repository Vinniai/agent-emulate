import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Some emulate packages render HTML (OAuth consent) via @emulators/core's
// shared Geist fonts; tsup inlines core's font loader, so copy the fonts
// alongside the bundle. Harmless for API-only packages.
const copyFonts = async () => {
  const src = resolve(__dirname, "../core/src/fonts");
  const dest = resolve(__dirname, "dist/fonts");
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  noExternal: [/^@emulators\/(core|native-kit)/],
  onSuccess: copyFonts,
});
