import { describe, it, expect } from "vitest";
import { Store } from "@emulators/core";
import { seedFromConfig, getUptickStore } from "../index.js";
import { BASE, DEFAULT_SEED } from "./helpers.js";

describe("uptick seedFromConfig idempotency", () => {
  it("re-seeding the same config does not duplicate any entity (incl. defects)", () => {
    const store = new Store();
    seedFromConfig(store, BASE, DEFAULT_SEED);
    const us = getUptickStore(store);
    const counts = {
      assetTypes: us.assetTypes.all().length,
      users: us.users.all().length,
      clients: us.clients.all().length,
      properties: us.properties.all().length,
      assets: us.assets.all().length,
      defects: us.defects.all().length,
    };
    expect(counts.defects).toBeGreaterThan(0); // guard the test itself

    // Re-run twice — mirrors /_admin/seed merge + apps/server reseedApps.
    seedFromConfig(store, BASE, DEFAULT_SEED);
    seedFromConfig(store, BASE, DEFAULT_SEED);

    expect({
      assetTypes: us.assetTypes.all().length,
      users: us.users.all().length,
      clients: us.clients.all().length,
      properties: us.properties.all().length,
      assets: us.assets.all().length,
      defects: us.defects.all().length,
    }).toEqual(counts);
  });
});
