import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// The Nango inspector UI (renderSettingsPage) references the shared Geist
// fonts bundled in @emulators/core. tsup inlines core's font loader, which
// resolves paths relative to *this* package's dist — so the font files must
// be copied alongside the bundle. Mirrors the other UI-serving packages.
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
  noExternal: [/^@emulators\/core/],
  onSuccess: copyFonts,
});
