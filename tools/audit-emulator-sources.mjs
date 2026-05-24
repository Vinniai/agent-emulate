import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sourceMapPath = join(root, "documentation", "emulator-source-map.json");
const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));

const routeRegex = /\bapp\.(get|post|patch|put|delete|options)\s*\(/g;

function countRoutes(service) {
  const pkg = service.package?.replace("@emulators/", "");
  if (!pkg) return null;
  const dir = join(root, "packages", "@emulators", pkg, "src");
  if (!existsSync(dir)) return null;
  const files = walk(dir).filter((file) => file.endsWith(".ts"));
  let count = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    count += [...text.matchAll(routeRegex)].length;
  }
  return count;
}

function countSwaggerOps(path) {
  if (!existsSync(path)) return null;
  const spec = JSON.parse(readFileSync(path, "utf8"));
  const methods = new Set(["get", "post", "patch", "put", "delete"]);
  let count = 0;
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (methods.has(method.toLowerCase())) count += 1;
    }
  }
  return count;
}

function countNativeModels(pkg) {
  const specPath = join(root, "packages", "@emulators", pkg, "src", "spec.ts");
  if (!existsSync(specPath)) return null;
  const text = readFileSync(specPath, "utf8");
  return [...text.matchAll(/\bmodel:\s*"/g)].length;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function ok(value) {
  return value ? "ok" : "missing";
}

console.log("Emulator source audit\n");
for (const service of sourceMap.services) {
  const artifacts = service.local_artifacts ?? [];
  const missing = artifacts.filter((artifact) => !existsSync(join(root, artifact)));
  const routeCount = countRoutes(service);
  const specOps = artifacts
    .filter((artifact) => artifact.endsWith(".json") && artifact.includes("swagger"))
    .map((artifact) => countSwaggerOps(join(root, artifact)))
    .find((count) => count != null);
  const nativeModels = service.package ? countNativeModels(service.package.replace("@emulators/", "")) : null;
  const details = [
    `source=${service.source_kind}`,
    `artifacts=${missing.length ? `missing:${missing.join(",")}` : ok(artifacts.length || service.source_urls?.length)}`,
    routeCount == null ? null : `routes=${routeCount}`,
    specOps == null ? null : `spec_ops=${specOps}`,
    nativeModels == null ? null : `native_models=${nativeModels}`,
    `status=${service.status}`,
  ].filter(Boolean);
  console.log(`${service.service.padEnd(32)} ${details.join("  ")}`);
}

console.log("\nGenerated native-kit providers");
for (const provider of sourceMap.generated_provider_packages) {
  const specPath = join(root, "packages", "@emulators", provider, "src", "spec.ts");
  const models = countNativeModels(provider);
  console.log(`${provider.padEnd(20)} spec=${existsSync(specPath) ? "ok" : "missing"}  models=${models ?? 0}`);
}
