import { makeNativePlugin } from "@emulators/native-kit";
import { spec } from "./spec.js";

// Standalone direct-to-source jira emulator. Mount it and clients hit
// jira's real native paths (/rest/api/3/issue, /rest/api/3/project) behind a bearer token — no Nango envelope. The Nango
// emulator remains the alternative; this is the "go direct" option.

const built = makeNativePlugin(spec);

export const jiraPlugin = built.plugin;
export const seedFromConfig = built.seedFromConfig;
export const storeToSeedConfig = built.storeToSeedConfig;
export default jiraPlugin;
