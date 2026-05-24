import { makeNativePlugin } from "@emulators/native-kit";
import { spec } from "./spec.js";

// Standalone direct-to-source mixpanel emulator. Mount it and clients hit
// mixpanel's real native paths (/api/2.0/events) behind a bearer token — no Nango envelope. The Nango
// emulator remains the alternative; this is the "go direct" option.

const built = makeNativePlugin(spec);

export const mixpanelPlugin = built.plugin;
export const seedFromConfig = built.seedFromConfig;
export const storeToSeedConfig = built.storeToSeedConfig;
export default mixpanelPlugin;
