import { AsyncLocalStorage } from "node:async_hooks";
import { Store, type Entity, type Collection, type StoreSnapshot } from "./store.js";

/**
 * Multi-tenant isolation (opt-in, Phase 4.2e).
 *
 * Real SaaS backends are multi-tenant: two orgs hitting the same provider
 * must never see each other's data. `TenantStore` gives the emulators the
 * same property without touching a single provider — it is a drop-in `Store`
 * whose every operation is routed to a *separate backing `Store` per tenant*,
 * the tenant being read from request-scoped `AsyncLocalStorage`.
 *
 * `createServer({ multiTenant: true })` (or `EMULATE_MULTI_TENANT=1`) wraps
 * the store in this and runs each request inside `withTenant(headerValue)`
 * using the `X-Emulate-Tenant` header (absent → the `"default"` tenant, which
 * makes single-tenant callers behave exactly as before — the default path is
 * byte-for-byte unchanged because multi-tenant is off unless asked for).
 *
 * It extends `Store` purely for nominal type-compatibility with
 * `plugin.register(app, store, …)`; the inherited private state is never used
 * — every public method is overridden to delegate to the resolved per-tenant
 * `Store`. Calls made *outside* any `withTenant(...)` scope (e.g. at
 * `plugin.register()` time, or `plugin.seed()`) resolve to the `"default"`
 * tenant, so register-time wiring and default seeds land where unscoped
 * requests read them.
 *
 * Known limitation (documented, not a bug): a plugin that caches a
 * `getData()` Map reference *once at register time* (the workos/setData-Map
 * pattern) keeps using that one `"default"` Map across tenants. Plugins that
 * call `store.collection(...)` / `store.getData(...)` per request — the
 * common CRUD pattern — isolate fully.
 */
const tenantContext = new AsyncLocalStorage<string>();

export const DEFAULT_TENANT = "default";

/** The tenant for the current async scope, or the default outside any scope. */
export function currentTenant(): string {
  return tenantContext.getStore() ?? DEFAULT_TENANT;
}

/** Run `fn` (and everything it awaits) with `tenant` as the active tenant. */
export function withTenant<T>(tenant: string | undefined, fn: () => T): T {
  return tenantContext.run(tenant && tenant.length > 0 ? tenant : DEFAULT_TENANT, fn);
}

export class TenantStore extends Store {
  private tenants = new Map<string, Store>();

  /** Resolve (lazily creating) the backing `Store` for the active tenant. */
  private backing(): Store {
    const key = currentTenant();
    let s = this.tenants.get(key);
    if (!s) {
      s = new Store();
      this.tenants.set(key, s);
    }
    return s;
  }

  /** Tenant ids that currently have a backing store (for inspection/tests). */
  tenantIds(): string[] {
    return [...this.tenants.keys()];
  }

  override collection<T extends Entity>(name: string, indexFields: (keyof T)[] = []): Collection<T> {
    return this.backing().collection<T>(name, indexFields);
  }

  override getData<V>(key: string): V | undefined {
    return this.backing().getData<V>(key);
  }

  override setData<V>(key: string, value: V): void {
    this.backing().setData<V>(key, value);
  }

  override reset(): void {
    this.backing().reset();
  }

  override snapshot(): StoreSnapshot {
    return this.backing().snapshot();
  }

  override restore(snap: StoreSnapshot): void {
    this.backing().restore(snap);
  }
}
