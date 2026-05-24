import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const specPath = resolve("documentation/simpro-swagger.json");
const outPath = resolve("examples/api-emulators-quickstart/src/simpro-routes.generated.ts");
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const routes = [];
for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
  for (const method of Object.keys(pathItem)) {
    if (method === "parameters") continue;
    routes.push([method.toUpperCase(), path.replace(/\{([^}]+)\}/g, ":$1")]);
  }
}

const extras = [
  ["GET", "/oauth/authorize"],
  ["GET", "/oauth2/authorize"],
  ["POST", "/oauth/token"],
  ["POST", "/oauth2/token"],
  ["GET", "/inspector/cost-centers"],
  ["GET", "/inspector/customers"],
  ["GET", "/inspector/invoices"],
  ["GET", "/inspector/jobs"],
  ["GET", "/inspector/sections"],
  ["GET", "/inspector/webhooks"],
];

const byKey = new Map();
for (const route of [...routes, ...extras]) byKey.set(`${route[0]} ${route[1]}`, route);
const all = [...byKey.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

const body = `// AUTO-GENERATED from documentation/simpro-swagger.json plus local OAuth/inspector routes. Do not edit by hand.
// Run: node tools/gen-simpro-routes.mjs
// ${routes.length} Swagger operations, ${all.length} total crawl endpoints.
export const SIMPRO_SWAGGER_OPERATION_COUNT = ${routes.length} as const;
export const SIMPRO_ROUTES: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(all, null, 2)} as const;
`;

writeFileSync(outPath, body);
