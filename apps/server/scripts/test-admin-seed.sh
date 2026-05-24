#!/usr/bin/env bash
# End-to-end test for /_admin/seed: pushes a fresh config, then exercises
# WorkOS login + Gmail OAuth + Simpro OAuth and verifies seeded values.
set -eo pipefail
BASE="${BASE:-http://localhost:4567}"
ADMIN_HEADER=()
if [[ -n "${EMULATE_ADMIN_TOKEN:-}" ]]; then
  ADMIN_HEADER=(-H "Authorization: Bearer ${EMULATE_ADMIN_TOKEN}")
fi
admin_curl() { curl -sS "${ADMIN_HEADER[@]+"${ADMIN_HEADER[@]}"}" "$@"; }

pass() { printf "  ✓ %s\n" "$1"; }
fail() { printf "  ✗ %s\n" "$1"; exit 1; }
hr()   { printf "\n──────────────────────────────────────────────────────────────\n%s\n──────────────────────────────────────────────────────────────\n" "$1"; }

hr "1. POST /_admin/seed with fresh config (carol + seeded data)"
SEED_RESP=$(curl -sS -X POST "$BASE/_admin/seed" \
  "${ADMIN_HEADER[@]}" \
  -H "content-type: application/json" \
  -d '{
    "users": [
      { "id": "carol", "role": "admin", "email": "carol@agent-emulate.dev", "name": "Carol Reseed",
        "providers": { "google": { "gmail": true }, "simpro": { "staff": true, "admin": true }, "workos": true } }
    ],
    "google": {
      "oauth_clients": [
        { "client_id": "emu_google_client_id", "client_secret": "emu_google_client_secret",
          "redirect_uris": ["http://app.test/cb/google"] }
      ],
      "messages": [
        { "id": "msg_reseeded", "user_email": "carol@agent-emulate.dev", "from": "ops@agent-emulate.dev",
          "to": "carol@agent-emulate.dev", "subject": "Reseeded Inbox", "body_text": "hello carol",
          "label_ids": ["INBOX","UNREAD"], "date": "2025-06-01T00:00:00.000Z" }
      ]
    },
    "simpro": {
      "oauth_clients": [
        { "client_id": "emu_simpro_client_id", "client_secret": "emu_simpro_client_secret",
          "redirect_uris": ["http://app.test/cb/simpro"] }
      ],
      "customers": [
        { "id": 9001, "type": "company", "company_name": "Reseeded Co", "email": "billing@agent-emulate.dev" }
      ]
    }
  }')
echo "$SEED_RESP" | python3 -m json.tool | head -20
echo "$SEED_RESP" | grep -q '"status":"seeded"' && pass "seed accepted" || fail "seed rejected"

hr "2. GET /_admin/users (carol present, alice/bob gone)"
USERS=$(admin_curl "$BASE/_admin/users")
echo "$USERS" | python3 -m json.tool | head -20
echo "$USERS" | grep -q "carol@agent-emulate.dev" && pass "carol listed" || fail "carol missing"
echo "$USERS" | grep -q "alice@agent-emulate.dev" && fail "alice still present (reseed didn't wipe)" || pass "alice cleared"
CAROL_TOK=$(echo "$USERS" | python3 -c 'import sys,json
d=json.load(sys.stdin)
for u in d["users"]:
  if u["email"]=="carol@agent-emulate.dev": print(u["token"]); break')
[[ -n "$CAROL_TOK" ]] && pass "carol token: $CAROL_TOK"

hr "3. WorkOS platform login as carol (Google SSO simulation)"
W_AUTH=$(curl -sS -X POST "$BASE/workos/user_management/authorize/callback" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "client_id=client_test&redirect_uri=http://app.test/cb&state=z&user_id=user_carol" -i)
W_CODE=$(echo "$W_AUTH" | grep -i "^location:" | sed -E 's/.*[?&]code=([^&[:space:]]+).*/\1/i' | tr -d '\r')
[[ -n "$W_CODE" ]] && pass "got authorize code: $W_CODE" || fail "no code"
W_TOK=$(curl -sS -X POST "$BASE/workos/user_management/authenticate" \
  -H "content-type: application/json" \
  -d "{\"client_id\":\"client_test\",\"client_secret\":\"sk\",\"grant_type\":\"authorization_code\",\"code\":\"$W_CODE\"}")
W_EMAIL=$(echo "$W_TOK" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("user",{}).get("email",""))')
[[ "$W_EMAIL" == "carol@agent-emulate.dev" ]] && pass "platform user = $W_EMAIL" || fail "wrong user: $W_EMAIL"

hr "4. Gmail OAuth (offline_access) → fetch seeded message"
G_AUTH=$(curl -sS -X POST "$BASE/google/o/oauth2/v2/auth/callback" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "client_id=emu_google_client_id&redirect_uri=http://app.test/cb/google&scope=openid%20email%20profile%20https://www.googleapis.com/auth/gmail.readonly&access_type=offline&state=g&email=carol@agent-emulate.dev" -i)
G_CODE=$(echo "$G_AUTH" | grep -i "^location:" | sed -E 's/.*[?&]code=([^&[:space:]]+).*/\1/i' | tr -d '\r')
G_TOK=$(curl -sS -X POST "$BASE/google/oauth2/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "grant_type=authorization_code&code=$G_CODE&client_id=emu_google_client_id&client_secret=emu_google_client_secret&redirect_uri=http://app.test/cb/google")
G_AT=$(echo "$G_TOK" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
G_RT=$(echo "$G_TOK" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("refresh_token") or "")')
[[ -n "$G_AT" && -n "$G_RT" ]] && pass "got gmail access+refresh tokens" || fail "no tokens"

MSGS=$(curl -sS -H "Authorization: Bearer $G_AT" "$BASE/google/gmail/v1/users/me/messages")
echo "$MSGS" | python3 -m json.tool | head -10
echo "$MSGS" | grep -q '"messages"' && pass "messages list returned"
MSG_ID=$(echo "$MSGS" | python3 -c 'import sys,json
d=json.load(sys.stdin); ms=d.get("messages") or []
print(ms[0]["id"] if ms else "")')
[[ -n "$MSG_ID" ]] && pass "found message id: $MSG_ID" || fail "no message in inbox"

MSG=$(curl -sS -H "Authorization: Bearer $G_AT" "$BASE/google/gmail/v1/users/me/messages/$MSG_ID?format=metadata")
echo "$MSG" | grep -q "Reseeded Inbox" && pass "subject = 'Reseeded Inbox'" || { echo "$MSG"; fail "wrong subject"; }

hr "5. Simpro OAuth (offline_access) → fetch seeded customer"
S_AUTH=$(curl -sS "$BASE/simpro/oauth2/authorize?response_type=code&client_id=emu_simpro_client_id&redirect_uri=http://app.test/cb/simpro&scope=offline_access&state=s" -i)
S_CODE=$(echo "$S_AUTH" | grep -i "^location:" | sed -E 's/.*[?&]code=([^&[:space:]]+).*/\1/i' | tr -d '\r')
S_TOK=$(curl -sS -X POST "$BASE/simpro/oauth2/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "grant_type=authorization_code&code=$S_CODE&redirect_uri=http://app.test/cb/simpro&client_id=emu_simpro_client_id&client_secret=emu_simpro_client_secret")
S_AT=$(echo "$S_TOK" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
S_RT=$(echo "$S_TOK" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("refresh_token") or "")')
[[ -n "$S_AT" && -n "$S_RT" ]] && pass "got simpro access+refresh tokens" || fail "no tokens"

CUSTS=$(curl -sS -H "Authorization: Bearer $S_AT" "$BASE/simpro/api/v1.0/companies/0/customers/companies/")
echo "$CUSTS" | python3 -m json.tool | head -25
echo "$CUSTS" | grep -q "Reseeded Co" && pass "found 'Reseeded Co'" || { echo "$CUSTS"; fail "seeded customer missing"; }

STAFF=$(curl -sS -H "Authorization: Bearer $S_AT" "$BASE/simpro/api/v1.0/companies/0/staff/")
echo "$STAFF" | grep -q "carol@agent-emulate.dev" && pass "carol seeded as staff" || { echo "$STAFF" | head -c 300; fail "carol not in staff"; }

hr "6. Refresh-token rotation on Simpro"
S_REFRESH=$(curl -sS -X POST "$BASE/simpro/oauth2/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "grant_type=refresh_token&refresh_token=$S_RT&client_id=emu_simpro_client_id&client_secret=emu_simpro_client_secret")
S_AT2=$(echo "$S_REFRESH" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
[[ -n "$S_AT2" && "$S_AT2" != "$S_AT" ]] && pass "refresh issued new access_token" || fail "refresh failed"
NEW_OK=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $S_AT2" "$BASE/simpro/api/v1.0/companies/0/customers/companies/")
[[ "$NEW_OK" == "200" ]] && pass "new access_token works on Simpro API" || fail "new token http=$NEW_OK"

hr "ALL TESTS PASSED"
