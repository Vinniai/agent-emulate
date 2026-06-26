/**
 * Nango Connect-UI emulation.
 *
 * The `@nangohq/frontend` SDK's `openConnectUI()` mounts an iframe whose `src`
 * is `<baseURL>/?apiURL=...` (the session token is NOT in the URL) and then
 * conducts a `window.postMessage` handshake:
 *
 *   iframe → parent : { type: "ready" }                 (on load)
 *   parent → iframe : { type: "session_token", sessionToken }
 *   iframe → parent : { type: "connect", payload }      (on authorize)
 *   iframe → parent : { type: "error", payload }        (on failure)
 *   iframe → parent : { type: "close" }                 (dismiss iframe)
 *
 * The data-viewer inspector served at `/` implements none of this, so the SDK
 * iframe never receives `ready`/`connect` and never closes. This page provides
 * the protocol. It is served from `/` when the `apiURL` query param is present
 * (the SDK always appends it), so normal inspector visits are unaffected.
 *
 * The page is fully same-origin: it resolves the provider label from
 * `GET /connect/session-info?token=...` and materialises the connection via the
 * existing `POST /connect/complete`, both registered by `sessionRoutes`.
 */
export function renderConnectUI(): string {
  return `<!DOCTYPE html><html>
  <head>
    <title>Nango Emulator — Connect UI</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      *{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:80px auto;padding:24px;background:#f0f2f5}
      .card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.1)}
      .badge{display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;margin-bottom:16px;letter-spacing:.5px;text-transform:uppercase}
      h2{margin:0 0 6px;color:#111;font-size:22px}
      .subtitle{color:#888;font-size:13px;margin:0 0 24px}
      button{width:100%;padding:13px;background:#5b6ef5;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
      button:hover{background:#4758d6}
      button:disabled{background:#a0a8d0;cursor:not-allowed}
      .status{margin-top:14px;font-size:13px;color:#666;text-align:center;min-height:18px}
      .loading{color:#888;font-size:14px;text-align:center;padding:8px 0}
      .emulator-note{margin-top:20px;font-size:11px;color:#bbb;text-align:center}
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">Emulator</div>
      <div id="loading" class="loading">Waiting for session…</div>
      <div id="ui" hidden>
        <h2 id="title">Connect</h2>
        <p class="subtitle">Nango local emulator — no real OAuth required</p>
        <button id="authorizeBtn">Authorize</button>
        <div class="status" id="status"></div>
        <p class="emulator-note">🔧 Nango Emulator • No real credentials sent</p>
      </div>
    </div>

    <script>
      var sessionToken = null;
      var integrationId = "";

      function send(message) {
        window.parent.postMessage(message, "*");
      }

      // Step 1 — tell the parent SDK the iframe is ready for the session token.
      send({ type: "ready" });

      // Step 2 — receive the session token from the parent and render the UI.
      window.addEventListener("message", async function (event) {
        var data = event.data;
        if (!data || data.type !== "session_token") return;
        sessionToken = data.sessionToken;

        var label = "Provider";
        try {
          var info = await fetch(
            "/connect/session-info?token=" + encodeURIComponent(sessionToken),
          ).then(function (r) { return r.json(); });
          if (info && !info.error) {
            integrationId = info.integrationId || "";
            label = info.providerLabel || info.provider || label;
          }
        } catch (_e) {
          /* fall back to the generic label */
        }

        document.getElementById("title").textContent = "Connect to " + label;
        document.getElementById("authorizeBtn").textContent = "Connect to " + label;
        document.getElementById("loading").hidden = true;
        document.getElementById("ui").hidden = false;
      });

      // Step 3 — on authorize, materialise the connection and report back.
      document
        .getElementById("authorizeBtn")
        .addEventListener("click", async function () {
          var btn = document.getElementById("authorizeBtn");
          var status = document.getElementById("status");
          btn.disabled = true;
          status.textContent = "Connecting…";
          try {
            var res = await fetch("/connect/complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: sessionToken }),
            });
            var data = await res.json();
            if (data.error) {
              send({
                type: "error",
                payload: { errorType: "unknown_error", errorMessage: data.error },
              });
              setTimeout(function () { send({ type: "close" }); }, 300);
              return;
            }
            status.textContent = "Connected!";
            // Step 4 — connect event drives the SDK's onEvent callback.
            send({
              type: "connect",
              payload: {
                providerConfigKey: data.integrationId || integrationId,
                connectionId: data.connectionId,
              },
            });
            // Step 5 — close so the SDK removes the iframe.
            setTimeout(function () { send({ type: "close" }); }, 400);
          } catch (err) {
            send({
              type: "error",
              payload: {
                errorType: "unknown_error",
                errorMessage: String((err && err.message) || err),
              },
            });
            setTimeout(function () { send({ type: "close" }); }, 300);
          }
        });
    </script>
  </body>
</html>`;
}
