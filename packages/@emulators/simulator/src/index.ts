// @emulators/simulator — an external activity driver for a running emulator.
//
// It streams new records/events into the emulator over time (emails landing in
// an inbox, Teams messages, WhatsApp inbound, Drive files, Calendar events) by
// hitting the public Nango API: appending records and triggering the sync /
// forward webhooks the emulator already speaks. Nothing here imports the
// emulator — it is a pure HTTP client, so it drives any deployment.

export { loadScenario, type Scenario, type Stream, SYNC_PROVIDERS, FORWARD_PROVIDERS } from "./scenario.js";
export {
  generate,
  registerGenerator,
  hasGenerator,
  generatorProviders,
  type GeneratedTick,
  type GeneratorFn,
} from "./generators.js";
export { Simulator, type SimulatorOptions, type TimerLike } from "./engine.js";
