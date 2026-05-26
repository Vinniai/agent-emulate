import pc from "picocolors";
import { SERVICE_REGISTRY, SERVICE_NAMES, type ServiceName } from "../registry.js";

// Group services so `list` reads as a menu rather than a flat dump. Any service
// not named here still prints, under "Other", so a newly added emulator never
// silently disappears from the listing.
const CATEGORIES: { title: string; services: ServiceName[] }[] = [
  { title: "Identity & SSO", services: ["github", "google", "apple", "microsoft", "okta", "clerk", "workos"] },
  { title: "Platforms & cloud", services: ["vercel", "aws", "mongoatlas"] },
  { title: "Payments & messaging", services: ["stripe", "resend", "slack"] },
  { title: "Integrations & field service", services: ["nango", "simpro", "uptick"] },
];

function printService(name: ServiceName): void {
  const entry = SERVICE_REGISTRY[name];
  console.log(`  ${pc.cyan(name.padEnd(12))}${entry.label}`);
  console.log(`  ${" ".repeat(12)}${pc.dim(entry.endpoints)}`);
}

export function listCommand(): void {
  console.log(`\n${pc.bold("agent-emulate")} ${pc.dim("— available services")}\n`);

  const categorized = new Set<ServiceName>();
  for (const { title, services } of CATEGORIES) {
    const present = services.filter((s) => s in SERVICE_REGISTRY);
    if (present.length === 0) continue;
    console.log(pc.bold(title));
    for (const name of present) {
      printService(name);
      categorized.add(name);
    }
    console.log();
  }

  const leftover = SERVICE_NAMES.filter((s) => !categorized.has(s));
  if (leftover.length > 0) {
    console.log(pc.bold("Other"));
    for (const name of leftover) printService(name);
    console.log();
  }

  console.log(pc.bold("Enable & seed"));
  console.log(`  Start all:        ${pc.cyan("npx agent-emulate")}`);
  console.log(`  Start some:       ${pc.cyan("npx agent-emulate -s github,stripe")}`);
  console.log(`  Scaffold config:  ${pc.cyan("npx agent-emulate init")}   ${pc.dim("(or: init -s github)")}`);
  console.log(`  Use a seed file:  ${pc.cyan("npx agent-emulate --seed ./emulate.config.yaml")}`);
  console.log();
  console.log(pc.dim("  Each service reads its data from a top-level <service>: key in the config."));
  console.log();
}
