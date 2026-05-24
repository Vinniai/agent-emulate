import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";

export function webhookRoutes(app: Hono<AppEnv>): void {
  app.post("/webhooks/test", async (c) => {
    const body = await c.req.json<{ event: string; data: Record<string, unknown>; target?: string }>();
    const target = body.target;
    if (!target) {
      return c.json({ error: "No webhook target. Pass target in body." }, 400);
    }

    const payload = {
      id: `evt_${Date.now()}`,
      event: body.event,
      data: body.data,
      created_at: new Date().toISOString(),
    };

    const secret = "whsec_test_emulator";
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(payload)));
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    try {
      const resp = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "workos-signature": `t=${Math.floor(Date.now() / 1000)},v1=${sigHex}`,
        },
        body: JSON.stringify(payload),
      });
      return c.json({ delivered: true, status: resp.status, event: body.event });
    } catch (err) {
      return c.json({ delivered: false, error: err instanceof Error ? err.message : "Delivery failed" }, 502);
    }
  });
}
