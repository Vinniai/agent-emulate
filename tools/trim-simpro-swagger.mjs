#!/usr/bin/env node
// Trim the Simpro Swagger spec to only the fields the emulator reads at runtime.
//
// The full vendor spec is ~25 MB of pretty-printed metadata (summaries,
// parameters, descriptions, non-2xx responses, top-level info/tags/menus). The
// spec-fallback emulator in packages/@emulators/simpro only ever reads:
//   - top-level: paths, definitions
//   - per path:  the HTTP method keys (get/post/patch/put/delete)
//   - per op:    responses 200/201/204, and only their `schema`
//   - per schema: $ref, type, format, enum, items, properties, example, default
//
// Everything else is dropped and the result is written compact. The path/method
// surface is preserved exactly, so the 1435-operation count test still holds.
//
// The transform is idempotent: re-trimming an already-trimmed spec is a no-op,
// so it is safe to run in place (the default when no output path is given).
//
// Usage: node tools/trim-simpro-swagger.mjs <input.json> [output.json]

import { readFileSync, writeFileSync } from "node:fs";

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);
const SUCCESS_STATUSES = ["200", "201", "204"];
const SCHEMA_KEYS = ["$ref", "type", "format", "enum", "items", "properties", "example", "default"];

function trimSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const out = {};
  for (const key of SCHEMA_KEYS) {
    if (!(key in schema)) continue;
    if (key === "items") {
      out.items = trimSchema(schema.items);
    } else if (key === "properties" && schema.properties && typeof schema.properties === "object") {
      const props = {};
      for (const [name, value] of Object.entries(schema.properties)) {
        props[name] = trimSchema(value);
      }
      out.properties = props;
    } else {
      // $ref, type, format, enum, example, default are kept verbatim.
      out[key] = schema[key];
    }
  }
  return out;
}

function trimResponses(responses) {
  if (!responses || typeof responses !== "object") return undefined;
  const out = {};
  for (const status of SUCCESS_STATUSES) {
    const response = responses[status];
    if (!response || typeof response !== "object") continue;
    out[status] = response.schema === undefined ? {} : { schema: trimSchema(response.schema) };
  }
  return out;
}

function trimSpec(spec) {
  const paths = {};
  for (const [specPath, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const trimmedItem = {};
    for (const [rawMethod, operation] of Object.entries(pathItem)) {
      if (!METHODS.has(rawMethod.toLowerCase())) continue;
      const responses = trimResponses(operation?.responses);
      trimmedItem[rawMethod] = responses === undefined ? {} : { responses };
    }
    paths[specPath] = trimmedItem;
  }

  const definitions = {};
  for (const [name, schema] of Object.entries(spec.definitions ?? {})) {
    definitions[name] = trimSchema(schema);
  }

  return { paths, definitions };
}

const [, , inputPath, outputArg] = process.argv;
if (!inputPath) {
  console.error("Usage: node tools/trim-simpro-swagger.mjs <input.json> [output.json]");
  process.exit(1);
}
const outputPath = outputArg ?? inputPath;

const spec = JSON.parse(readFileSync(inputPath, "utf8"));
const trimmed = trimSpec(spec);
writeFileSync(outputPath, JSON.stringify(trimmed));

const operations = Object.values(trimmed.paths).reduce(
  (count, pathItem) => count + Object.keys(pathItem).filter((key) => key !== "parameters").length,
  0,
);
console.log(`Trimmed ${Object.keys(trimmed.paths).length} paths, ${operations} operations, ${Object.keys(trimmed.definitions).length} definitions -> ${outputPath}`);
