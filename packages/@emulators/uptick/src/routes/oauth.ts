import type { RouteContext } from "@emulators/core";

function generateToken(): string {
  return `uptick-token-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function oauthRoutes({ app }: RouteContext): void {
  // POST /api/oauth2/token/
  // Accepts password or refresh_token grant type.
  // Client credentials via HTTP Basic Auth (not validated in emulator).
  // Body: multipart/form-data or application/x-www-form-urlencoded
  app.post("/api/oauth2/token/", async (c) => {
    let grantType: string | undefined;

    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData().catch(() => null);
      grantType = form?.get("grant_type")?.toString();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await c.req.text();
      const params = new URLSearchParams(text);
      grantType = params.get("grant_type") ?? undefined;
    } else {
      // Try JSON fallback
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      grantType = typeof body.grant_type === "string" ? body.grant_type : undefined;
    }

    if (!grantType) {
      return c.json({ error: "invalid_request", error_description: "grant_type is required" }, 400);
    }

    if (grantType !== "password" && grantType !== "refresh_token") {
      return c.json({ error: "unsupported_grant_type" }, 400);
    }

    return c.json({
      access_token: generateToken(),
      refresh_token: generateToken(),
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read write",
    });
  });
}
