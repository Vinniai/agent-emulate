import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import type { NangoStoreFacade } from "../store.js";

function makeSessionToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `nango_session_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function makeConnectionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `conn_emu_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

interface EmulatorSession {
  token: string;
  provider: string;
  integrationId: string;
  userId: string;
  orgId: string;
  siteUrl: string;
  connectionId?: string;
  webhookUrl?: string;
  createdAt: number;
}

// In-memory session store (lives for the process lifetime)
const sessionStore = new Map<string, EmulatorSession>();

// Clean up sessions older than 30 minutes
function pruneExpiredSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [token, session] of sessionStore) {
    if (session.createdAt < cutoff) {
      sessionStore.delete(token);
    }
  }
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    xero: "Xero",
    "quickbooks-sandbox": "QuickBooks (Sandbox)",
    quickbooks: "QuickBooks",
    myob: "MYOB",
    "google-drive": "Google Drive",
    onedrive: "OneDrive",
    hubspot: "HubSpot",
    slack: "Slack",
  };
  return labels[provider] ?? provider;
}

export function sessionRoutes(app: Hono<AppEnv>, baseUrl: string, ns: NangoStoreFacade): void {
  // POST /connect/sessions — create a new connect session
  app.post("/connect/sessions", async (c) => {
    pruneExpiredSessions();

    const body = await c.req.json<{
      end_user?: { id?: string; tags?: { organizationId?: string; provider?: string } };
      allowed_integrations?: string[];
      _emulator_siteUrl?: string;
    }>();

    const token = makeSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const integrationId = body.allowed_integrations?.[0] ?? "unknown";
    const userId = body.end_user?.id ?? "";
    const orgId = body.end_user?.tags?.organizationId ?? "";
    const siteUrl = body._emulator_siteUrl ?? "";

    sessionStore.set(token, {
      token,
      provider: integrationId,
      integrationId,
      userId,
      orgId,
      siteUrl,
      createdAt: Date.now(),
    });

    const connectLink = `${baseUrl}/connect?token=${token}`;
    return c.json({
      data: {
        token,
        connect_link: connectLink,
        expires_at: expiresAt,
      },
    });
  });

  // POST /connect/sessions/reconnect — reconnect session (same shape)
  app.post("/connect/sessions/reconnect", async (c) => {
    pruneExpiredSessions();

    const body = await c.req.json<{
      end_user?: { id?: string; tags?: { organizationId?: string } };
      connection_id?: string;
      integration_id?: string;
      _emulator_siteUrl?: string;
    }>();

    const token = makeSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const integrationId = body.integration_id ?? "unknown";
    const userId = body.end_user?.id ?? "";
    const orgId = body.end_user?.tags?.organizationId ?? "";
    const siteUrl = body._emulator_siteUrl ?? "";

    sessionStore.set(token, {
      token,
      provider: integrationId,
      integrationId,
      userId,
      orgId,
      siteUrl,
      connectionId: body.connection_id,
      createdAt: Date.now(),
    });

    const connectLink = `${baseUrl}/connect?token=${token}&reconnect=1&connection_id=${body.connection_id ?? ""}`;
    return c.json({
      data: {
        token,
        connect_link: connectLink,
        expires_at: expiresAt,
      },
    });
  });

  // GET /connect — interactive connect UI
  app.get("/connect", (c) => {
    const token = c.req.query("token") ?? "";
    const session = sessionStore.get(token);
    const isReconnect = c.req.query("reconnect") === "1";
    const label = session ? providerLabel(session.provider) : "Unknown Provider";

    if (!session) {
      return c.html(`<!DOCTYPE html><html>
        <head>
          <title>Nango Emulator — Session Expired</title>
          <meta charset="utf-8">
          <style>body{font-family:system-ui;max-width:420px;margin:80px auto;padding:24px;background:#f9f9f9}
          .card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
          h2{margin:0 0 8px;color:#111}p{color:#666;margin:0 0 16px}</style>
        </head>
        <body>
          <div class="card">
            <h2>Session Expired</h2>
            <p>This connect link has expired or is invalid. Please try connecting again from the app.</p>
          </div>
        </body>
      </html>`);
    }

    const action = `${baseUrl}/connect/complete`;

    return c.html(`<!DOCTYPE html><html>
      <head>
        <title>Nango Emulator — Connect ${label}</title>
        <meta charset="utf-8">
        <style>
          *{box-sizing:border-box}
          body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:80px auto;padding:24px;background:#f0f2f5}
          .card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.1)}
          .badge{display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;margin-bottom:16px;letter-spacing:.5px;text-transform:uppercase}
          h2{margin:0 0 6px;color:#111;font-size:22px}
          .subtitle{color:#888;font-size:13px;margin:0 0 24px}
          .info{background:#f7f7f7;border-radius:8px;padding:14px 16px;margin-bottom:20px;font-size:13px;color:#444}
          .info span{font-weight:600;color:#111}
          .info p{margin:4px 0}
          button{width:100%;padding:13px;background:#5b6ef5;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
          button:hover{background:#4758d6}
          button:disabled{background:#a0a8d0;cursor:not-allowed}
          .status{margin-top:14px;font-size:13px;color:#666;text-align:center;min-height:18px}
          .emulator-note{margin-top:20px;font-size:11px;color:#bbb;text-align:center}
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">Emulator</div>
          <h2>${isReconnect ? "Reconnect" : "Connect"} ${label}</h2>
          <p class="subtitle">Nango local emulator — no real OAuth required</p>
          <div class="info">
            <p><span>Provider:</span> ${label}</p>
            <p><span>User ID:</span> ${session.userId || "(not set)"}</p>
            <p><span>Org ID:</span> ${session.orgId || "(not set)"}</p>
            ${session.connectionId ? `<p><span>Connection:</span> ${session.connectionId}</p>` : ""}
          </div>
          <button id="connectBtn" onclick="completeConnect()">
            ${isReconnect ? "Reconnect" : "Connect"} to ${label}
          </button>
          <div class="status" id="status"></div>
          <p class="emulator-note">🔧 Nango Emulator • No real credentials sent</p>
        </div>

        <script>
          async function completeConnect() {
            const btn = document.getElementById('connectBtn');
            const status = document.getElementById('status');
            btn.disabled = true;
            btn.textContent = 'Connecting...';
            status.textContent = 'Creating connection…';
            try {
              const res = await fetch('${action}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: '${token}' })
              });
              const data = await res.json();
              if (data.redirectUrl) {
                status.textContent = 'Connected! Redirecting…';
                setTimeout(() => { window.location.href = data.redirectUrl; }, 500);
              } else if (data.error) {
                status.textContent = 'Error: ' + data.error;
                btn.disabled = false;
                btn.textContent = 'Retry';
              } else {
                status.textContent = 'Done.';
              }
            } catch (err) {
              status.textContent = 'Request failed: ' + err.message;
              btn.disabled = false;
              btn.textContent = 'Retry';
            }
          }
        </script>
      </body>
    </html>`);
  });

  // POST /connect/complete — fires auth webhook to dashboard + returns redirect
  app.post("/connect/complete", async (c) => {
    const body = await c.req.json<{ token: string }>();
    const session = sessionStore.get(body.token);

    if (!session) {
      return c.json({ error: "Session not found or expired" }, 404);
    }

    const connectionId = session.connectionId ?? makeConnectionId();

    // Ensure connection exists in the store
    const existing = ns.getConnection(connectionId);
    if (!existing) {
      const now = new Date().toISOString();
      // Some providers require specific fields in connection_config for proxy calls:
      //   Xero  — tenantId (UUID): routes proxy requests to the right organisation
      //   QuickBooks — realmId (company ID): required for all API calls
      // Seed stable fake values so the resolve helpers succeed in dev.
      const isXero = session.provider === "xero";
      const isQBO = session.provider === "quickbooks" || session.provider === "quickbooks-sandbox";
      const connectionConfig: Record<string, unknown> = isXero
        ? { tenantId: "emu-xero-tenant-00000000-0000-0000-0000-000000000001" }
        : isQBO
          ? { realmId: "9341453644728342", companyName: "Emulator Company" }
          : {};
      ns.upsertConnection({
        id: connectionId,
        connection_id: connectionId,
        provider: session.provider,
        provider_config_key: session.integrationId,
        credentials: {
          access_token: `emulator-token-${connectionId}`,
          refresh_token: `emulator-refresh-${connectionId}`,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          type: "OAuth2",
        },
        connection_config: connectionConfig,
        metadata: {
          organizationId: session.orgId,
          userId: session.userId,
        },
        created_at: now,
        updated_at: now,
      });
    }

    // Fire the auth webhook to the dashboard so Taskr creates the appConnection
    if (session.siteUrl) {
      const webhookUrl = `${session.siteUrl}/api/integrations/nango/webhooks`;
      const webhookPayload = {
        type: "auth_linked",
        data: {
          connection: {
            id: connectionId,
            connection_id: connectionId,
            provider: session.provider,
            provider_config_key: session.integrationId,
          },
          end_user: {
            id: session.userId,
            tags: {
              organizationId: session.orgId,
              provider: session.provider,
            },
          },
          organization: {
            id: session.orgId,
          },
        },
      };

      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
        });
      } catch {
        // Non-fatal — connection was created in store, webhook delivery is best-effort
        console.warn(`[Nango emulator] Could not fire auth webhook to ${webhookUrl}`);
      }
    }

    // Clean up the session
    sessionStore.delete(body.token);

    // Build redirect URL back to the dashboard
    const appId = mapProviderToAppId(session.provider);
    const redirectUrl = session.siteUrl
      ? `${session.siteUrl}/apps/${appId}?connected=true&connectionId=${connectionId}`
      : `/`;

    return c.json({ ok: true, connectionId, redirectUrl });
  });
}

function mapProviderToAppId(provider: string): string {
  const map: Record<string, string> = {
    xero: "xero",
    "quickbooks-sandbox": "quickbooks",
    quickbooks: "quickbooks",
    myob: "myob",
    "google-drive": "google-drive",
    onedrive: "onedrive",
    hubspot: "hubspot",
    slack: "slack",
  };
  return map[provider] ?? provider;
}
