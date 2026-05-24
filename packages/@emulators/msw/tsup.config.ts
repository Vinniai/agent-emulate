import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  // `msw` is a peer dependency (the consumer owns the version + service worker),
  // and `@emulators/core` is a normal runtime dependency — keep both external.
  external: ["msw", "@emulators/core"],
});
