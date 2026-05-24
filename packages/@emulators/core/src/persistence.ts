import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Store, StoreSnapshot } from "./store.js";

export interface PersistenceAdapter {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
}

/** On-disk shape written by {@link snapshotBundle}: one {@link StoreSnapshot}
 *  per service, behind a version tag so the format can evolve. */
export interface ServerSnapshot {
  version: 1;
  savedAt: string;
  services: Record<string, StoreSnapshot>;
}

/** Serialise every service store into one JSON document. The per-store
 *  snapshot already JSON-encodes Map/Set values, so the result is portable. */
export function snapshotBundle(stores: Map<string, Store>): string {
  const services: Record<string, StoreSnapshot> = {};
  for (const [name, store] of stores) services[name] = store.snapshot();
  const bundle: ServerSnapshot = { version: 1, savedAt: new Date().toISOString(), services };
  return JSON.stringify(bundle);
}

/**
 * Restore each store whose name appears in the bundle; returns the names
 * actually restored. Best-effort by design — malformed JSON, an unknown
 * version, or a service that no longer exists is skipped (returns `[]`
 * rather than throwing), so a stale or partial snapshot can never crash boot.
 */
export function restoreBundle(stores: Map<string, Store>, json: string): string[] {
  let bundle: Partial<ServerSnapshot> | null;
  try {
    bundle = JSON.parse(json) as Partial<ServerSnapshot>;
  } catch {
    return [];
  }
  const services = bundle?.services;
  if (!services || typeof services !== "object") return [];
  const restored: string[] = [];
  for (const [name, store] of stores) {
    const snap = services[name];
    if (snap && typeof snap === "object" && "collections" in snap && "data" in snap) {
      store.restore(snap);
      restored.push(name);
    }
  }
  return restored;
}

export function filePersistence(path: string): PersistenceAdapter {
  return {
    async load() {
      try {
        return await readFile(path, "utf-8");
      } catch {
        return null;
      }
    },
    async save(data: string) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, "utf-8");
    },
  };
}
