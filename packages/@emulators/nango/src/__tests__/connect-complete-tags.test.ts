// Regression guard for the org-scoping gap: `connect/complete` must mirror the
// session's org/user identity into the connection's `tags` (lowercase
// snake_case) — not just `metadata` — so the list endpoint can filter
// server-side with `GET /connections?tags[organization_id]=<org>`. Before the
// fix, complete wrote only camelCase `metadata`, so org-scoped listing returned
// nothing for connections created through the connect flow.
import { describe, it, expect } from "vitest";
import { createTestApp, nangoStore, json, BASE } from "./helpers.js";

async function completeConnection(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  opts: { userId: string; orgId: string; integration: string },
): Promise<string> {
  const sessionRes = await app.request(
    `${BASE}/connect/sessions`,
    json({
      end_user: { id: opts.userId, tags: { organizationId: opts.orgId } },
      allowed_integrations: [opts.integration],
    }),
  );
  const { data } = (await sessionRes.json()) as { data: { token: string } };
  const completeRes = await app.request(`${BASE}/connect/complete`, json({ token: data.token }));
  expect(completeRes.status).toBe(200);
  const { connectionId } = (await completeRes.json()) as { connectionId: string };
  return connectionId;
}

describe("connect/complete — org/user tags", () => {
  it("mirrors session org + user into lowercase snake_case tags", async () => {
    const { app, store } = createTestApp();
    const connectionId = await completeConnection(app, {
      userId: "user_dev",
      orgId: "org_test_taskr",
      integration: "xero",
    });

    const conn = nangoStore(store).getConnection(connectionId);
    expect(conn?.tags).toMatchObject({
      organization_id: "org_test_taskr",
      end_user_id: "user_dev",
    });
    // metadata keeps the camelCase shape for backward compatibility.
    expect(conn?.metadata).toMatchObject({ organizationId: "org_test_taskr", userId: "user_dev" });
  });

  it("is discoverable via GET /connections?tags[organization_id]=", async () => {
    const { app } = createTestApp();
    await completeConnection(app, { userId: "user_dev", orgId: "org_test_taskr", integration: "xero" });
    await completeConnection(app, { userId: "user_dev", orgId: "org_other", integration: "quickbooks" });

    const res = await app.request(`${BASE}/connections?tags[organization_id]=org_test_taskr`);
    const { connections } = (await res.json()) as {
      connections: Array<{ provider: string; tags: Record<string, string> }>;
    };
    expect(connections).toHaveLength(1);
    expect(connections[0].provider).toBe("xero");
    expect(connections[0].tags.organization_id).toBe("org_test_taskr");
  });
});
