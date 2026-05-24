import { makeNativePlugin } from "@emulators/native-kit";
import { spec } from "./spec.js";

// Standalone direct-to-source zendesk emulator. Mount it and clients hit
// zendesk's real native paths (/api/v2/tickets, /api/v2/users) behind a bearer token — no Nango envelope. The Nango
// emulator remains the alternative; this is the "go direct" option.

const built = makeNativePlugin(spec);

export const zendeskPlugin = built.plugin;
export const seedFromConfig = built.seedFromConfig;
export const storeToSeedConfig = built.storeToSeedConfig;
export default zendeskPlugin;
