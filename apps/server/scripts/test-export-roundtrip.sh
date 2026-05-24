#!/usr/bin/env bash
# End-to-end test for the seed-driven primitive work:
#   F1  config suppresses a service's built-in defaults
#   F2  POST /_admin/seed?mode=merge layers data without wiping
#   F3  GET /_admin/export round-trips back through /_admin/seed
#
# Requires a running emulate-server (defaults to :4567). Boot with:
#   PORT=4567 node apps/server/dist/index.js
set -eo pipefail
BASE="${BASE:-http://localhost:4567}"
ADMIN_HEADER=()
if [[ -n "${EMULATE_ADMIN_TOKEN:-}" ]]; then
  ADMIN_HEADER=(-H "Authorization: Bearer ${EMULATE_ADMIN_TOKEN}")
fi
admin_curl() { curl -sS "${ADMIN_HEADER[@]+"${ADMIN_HEADER[@]}"}" "$@"; }
jq_get() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

pass() { printf "  ✓ %s\n" "$1"; }
fail() { printf "  ✗ %s\n" "$1"; exit 1; }
hr()   { printf "\n──────────────────────────────────────────────────────────────\n%s\n──────────────────────────────────────────────────────────────\n" "$1"; }

SEED='{
  "google": {
    "oauth_clients": [
      { "client_id": "emu_google_client_id", "client_secret": "emu_google_secret",
        "redirect_uris": ["http://app.test/cb/google"] }
    ],
    "users": [ { "email": "dana@agent-emulate.dev", "name": "Dana Ops" } ],
    "messages": [
      { "id": "msg_seed", "user_email": "dana@agent-emulate.dev", "from": "ops@agent-emulate.dev",
        "to": "dana@agent-emulate.dev", "subject": "Seeded Inbox", "body_text": "hello dana",
        "label_ids": ["INBOX","UNREAD"], "date": "2026-06-01T00:00:00.000Z" }
    ]
  },
  "nango": {
    "connections": [
      { "id": "xero-acme", "provider": "xero", "provider_config_key": "xero",
        "connection_config": { "tenantId": "tenant-acme" }, "metadata": { "organizationId": "org_acme" },
        "records": { "Invoice": [ { "InvoiceID": "x-1", "Total": 990 } ] } }
    ]
  },
  "uptick": {
    "asset_types": [ { "name": "Sprinkler System" } ],
    "clients": [ { "name": "Acme Facilities Pty Ltd", "contact_email": "ops@agent-emulate.dev" } ],
    "properties": [ { "name": "North Campus A", "client_name": "Acme Facilities Pty Ltd" } ],
    "assets": [ { "name": "Riser #1", "asset_type_name": "Sprinkler System",
                  "property_name": "North Campus A", "client_name": "Acme Facilities Pty Ltd" } ]
  }
}'

hr "1. F1 (baseline) — booted with NO config, google ran its built-in defaults"
# This server must be booted from a directory with no emulate.config.* so all
# plugins run plugin.seed(). google's converter lets us observe it directly.
PRE=$(admin_curl "$BASE/_admin/export?service=google")
echo "$PRE" | grep -q "testuser@agent-emulate.dev" \
  && pass "google default user present (no config ⇒ defaults run)" \
  || fail "google defaults missing at boot — F1 negative branch broken"

hr "2. POST /_admin/seed (replace) — google/nango/uptick only"
R=$(curl -sS -X POST "$BASE/_admin/seed" "${ADMIN_HEADER[@]}" -H "content-type: application/json" -d "$SEED")
echo "$R" | python3 -m json.tool | head -8
echo "$R" | grep -q '"status":"seeded"' && pass "seed accepted" || fail "seed rejected"

hr "3. F1 — pushed config suppresses google's built-in defaults"
EXP=$(admin_curl "$BASE/_admin/export?service=google")
echo "$EXP" | grep -q "dana@agent-emulate.dev" && pass "Acme user present" || fail "Acme user missing"
echo "$EXP" | grep -q "testuser@agent-emulate.dev" && fail "built-in default leaked (testuser@agent-emulate.dev)" || pass "no testuser@agent-emulate.dev — defaults suppressed"

hr "4. Mutate via the API — raise an Uptick defect"
UTOK=$(curl -sS -X POST "$BASE/uptick/api/oauth2/token/" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "grant_type=password&username=tech@agent-emulate.dev&password=hunter2" | jq_get 'd["access_token"]')
[[ -n "$UTOK" ]] && pass "uptick token acquired" || fail "no uptick token"
AID=$(curl -sS -H "Authorization: Bearer $UTOK" "$BASE/uptick/api/v2/assets/" \
  | jq_get 'd["data"][0]["id"]')
[[ -n "$AID" ]] && pass "seeded asset id: $AID" || fail "no seeded asset"
curl -sS -X POST "$BASE/uptick/api/v2/defects/" \
  -H "Authorization: Bearer $UTOK" -H "content-type: application/vnd.api+json" \
  -d "{\"data\":{\"type\":\"Defect\",\"attributes\":{\"description\":\"Gauge below spec\",\"severity\":\"high\",\"status\":\"open\"},\"relationships\":{\"asset\":{\"data\":{\"type\":\"Asset\",\"id\":\"$AID\"}}}}}" >/dev/null
pass "defect created via JSON:API"

hr "5. F2 — merge a new google message (no wipe)"
M=$(curl -sS -X POST "$BASE/_admin/seed?mode=merge" "${ADMIN_HEADER[@]}" -H "content-type: application/json" -d '{
  "google": { "messages": [
    { "id": "msg_merged", "user_email": "dana@agent-emulate.dev", "from": "new@agent-emulate.dev",
      "to": "dana@agent-emulate.dev", "subject": "Merged Message", "body_text": "added",
      "label_ids": ["INBOX"], "date": "2026-06-02T00:00:00.000Z" } ] } }')
echo "$M" | grep -q '"status":"merged"' && pass "merge accepted" || fail "merge rejected"
GEXP=$(admin_curl "$BASE/_admin/export?service=google")
echo "$GEXP" | grep -q "Seeded Inbox"  && pass "original message survived merge" || fail "merge wiped original"
echo "$GEXP" | grep -q "Merged Message" && pass "merged message present"          || fail "merged message missing"

hr "6. F3 — export: credentials stripped, client_secret retained, defect resolved"
FULL=$(admin_curl "$BASE/_admin/export")
echo "$FULL" | jq_get '"CREDS=" + ("credentials" in d["nango"]["connections"][0] and "yes" or "no")' | grep -q "CREDS=no" \
  && pass "nango credentials stripped by default" || fail "nango credentials leaked"
echo "$FULL" | grep -q "emu_google_secret" && pass "google oauth client_secret retained" || fail "client_secret stripped"
echo "$FULL" | jq_get 'd["uptick"]["defects"][0]["asset_name"]' | grep -q "Riser #1" \
  && pass "uptick defect FK resolved to asset_name" || fail "defect asset_name not resolved"
WITHCREDS=$(admin_curl "$BASE/_admin/export?service=nango&includeCredentials=true")
echo "$WITHCREDS" | grep -q "credentials" && pass "includeCredentials=true emits credentials" || fail "includeCredentials ignored"

hr "7. F3 — round-trip: re-seed the export verbatim, then re-export"
curl -sS -X POST "$BASE/_admin/seed" "${ADMIN_HEADER[@]}" -H "content-type: application/json" -d "$FULL" \
  | grep -q '"status":"seeded"' && pass "export re-accepted by /_admin/seed" || fail "export not re-seedable"
RT=$(admin_curl "$BASE/_admin/export")
echo "$RT" | grep -q "dana@agent-emulate.dev"        && pass "google user round-tripped"   || fail "google user lost"
echo "$RT" | grep -q "Seeded Inbox"             && pass "google message round-tripped" || fail "google message lost"
echo "$RT" | grep -q "xero-acme"                && pass "nango connection round-tripped" || fail "nango lost"
echo "$RT" | grep -q "Acme Facilities Pty Ltd"  && pass "uptick client round-tripped"  || fail "uptick client lost"
echo "$RT" | jq_get 'd["uptick"]["defects"][0]["asset_name"]' | grep -q "Riser #1" \
  && pass "uptick defect round-tripped with resolved name" || fail "uptick defect lost on round-trip"

hr "8. F3 — yaml format is well-formed and re-parseable"
admin_curl "$BASE/_admin/export?format=yaml" \
  | python3 -c 'import sys,yaml;d=yaml.safe_load(sys.stdin);assert "nango" in d and "uptick" in d;print("ok")' \
  | grep -q ok && pass "yaml export parses and contains services" || fail "yaml export malformed"

hr "ALL TESTS PASSED"
