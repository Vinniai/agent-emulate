import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Connection = {
  id: string;
  provider: string;
  provider_config_key: string;
  metadata?: { category?: string; profile?: string; model?: string };
};

type NangoRecord = {
  id?: unknown;
  Id?: unknown;
  ID?: unknown;
  _nango_metadata?: {
    deleted_at?: string | null;
    first_seen_at?: string;
    last_action?: string;
    last_modified_at?: string;
    cursor?: string;
  };
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baseUrl = (arg("--base-url") ?? process.env.NANGO_VALIDATE_BASE_URL ?? "http://localhost:4040").replace(
  /\/$/,
  "",
);
const authToken = arg("--auth-token") ?? process.env.NANGO_SECRET_KEY;
const singleConnectionId = arg("--connection-id");
const singleProviderConfigKey = arg("--provider-config-key");
const singleModel = arg("--model");
const webhookSecret = arg("--webhook-secret") ?? "whsec_validate";

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extra,
  };
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers: headers(init?.headers as Record<string, string>) });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function assertRecordShape(conn: Connection, record: NangoRecord): void {
  if (!record || typeof record !== "object") throw new Error(`${conn.id} returned a non-object record`);
  const metadata = record._nango_metadata;
  if (!metadata) throw new Error(`${conn.id} record is missing _nango_metadata`);
  if (metadata.deleted_at !== null)
    throw new Error(`${conn.id} metadata.deleted_at should be null for active seed rows`);
  if (metadata.last_action !== "ADDED") throw new Error(`${conn.id} metadata.last_action should be ADDED`);
  if (!metadata.first_seen_at || Number.isNaN(Date.parse(metadata.first_seen_at))) {
    throw new Error(`${conn.id} metadata.first_seen_at is not an ISO timestamp`);
  }
  if (!metadata.last_modified_at || Number.isNaN(Date.parse(metadata.last_modified_at))) {
    throw new Error(`${conn.id} metadata.last_modified_at is not an ISO timestamp`);
  }
  if (!metadata.cursor) throw new Error(`${conn.id} metadata.cursor is missing`);
}

async function validateRecords(conn: Connection, model: string): Promise<number> {
  const first = await getJson<{ records: NangoRecord[]; next_cursor: string | null }>(
    `/records?model=${encodeURIComponent(model)}&limit=2`,
    { headers: { "Connection-Id": conn.id, "Provider-Config-Key": conn.provider_config_key } },
  );
  if (!Array.isArray(first.records)) throw new Error(`${conn.id}/${model} did not return records[]`);
  if (first.records.length === 0) throw new Error(`${conn.id}/${model} returned no records`);
  first.records.forEach((record) => assertRecordShape(conn, record));

  if (first.next_cursor) {
    const second = await getJson<{ records: NangoRecord[] }>(
      `/records?model=${encodeURIComponent(model)}&cursor=${encodeURIComponent(first.next_cursor)}`,
      { headers: { "Connection-Id": conn.id, "Provider-Config-Key": conn.provider_config_key } },
    );
    if (second.records.length === 0) throw new Error(`${conn.id}/${model} cursor did not return a next page`);
    second.records.forEach((record) => assertRecordShape(conn, record));
  }

  const firstId = first.records[0]?.id ?? first.records[0]?.Id ?? first.records[0]?.ID;
  if (firstId !== undefined) {
    const byId = await getJson<{ records: NangoRecord[] }>(
      `/records?model=${encodeURIComponent(model)}&ids=${encodeURIComponent(String(firstId))}&filter=added`,
      { headers: { "Connection-Id": conn.id, "Provider-Config-Key": conn.provider_config_key } },
    );
    if (byId.records.length !== 1)
      throw new Error(`${conn.id}/${model} ids filter returned ${byId.records.length} records`);
  }

  const all = await getJson<{ records: NangoRecord[] }>(`/records?model=${encodeURIComponent(model)}&limit=1000`, {
    headers: { "Connection-Id": conn.id, "Provider-Config-Key": conn.provider_config_key },
  });
  return all.records.length;
}

function verifySignature(body: string, signature: string | undefined): boolean {
  return signature === createHmac("sha256", webhookSecret).update(body).digest("hex");
}

async function startReceiver(): Promise<{
  url: string;
  next: () => Promise<{ body: string; headers: Record<string, string | undefined> }>;
  close: () => Promise<void>;
}> {
  const queue: Array<{ body: string; headers: Record<string, string | undefined> }> = [];
  const waiters: Array<(hit: { body: string; headers: Record<string, string | undefined> }) => void> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const hit = {
        body: Buffer.concat(chunks).toString("utf8"),
        headers: req.headers as Record<string, string | undefined>,
      };
      const waiter = waiters.shift();
      if (waiter) waiter(hit);
      else queue.push(hit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Receiver did not bind to a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}/nango`,
    next: () => {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function validateWebhooks(conn: Connection, model: string): Promise<void> {
  const receiver = await startReceiver();
  try {
    await getJson("/webhook-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: receiver.url, secret: webhookSecret }),
    });
    await getJson("/sync/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_config_key: conn.provider_config_key,
        connection_id: conn.id,
        model,
        syncType: "WEBHOOK",
      }),
    });
    const syncHit = await receiver.next();
    const syncPayload = JSON.parse(syncHit.body) as Record<string, unknown>;
    if (syncPayload.type !== "sync" || syncPayload.syncType !== "WEBHOOK")
      throw new Error("Sync webhook payload mismatch");
    if (!verifySignature(syncHit.body, syncHit.headers["x-nango-hmac-sha256"]))
      throw new Error("Missing current Nango HMAC header");
    if (!verifySignature(syncHit.body, syncHit.headers["x-nango-signature"]))
      throw new Error("Missing compatible Nango signature header");

    await getJson(`/webhook/env-validate/${encodeURIComponent(conn.provider_config_key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connection-Id": conn.id },
      body: JSON.stringify({ event: "validate", provider: conn.provider }),
    });
    const forwardHit = await receiver.next();
    const forwardPayload = JSON.parse(forwardHit.body) as Record<string, unknown>;
    if (forwardPayload.type !== "forward" || forwardPayload.connectionId !== conn.id) {
      throw new Error("Forwarded webhook payload mismatch");
    }
  } finally {
    await receiver.close();
  }
}

async function main(): Promise<void> {
  const connections =
    singleConnectionId && singleProviderConfigKey && singleModel
      ? [
          {
            id: singleConnectionId,
            provider: singleProviderConfigKey,
            provider_config_key: singleProviderConfigKey,
            metadata: { model: singleModel },
          },
        ]
      : (await getJson<{ connections: Connection[] }>("/connection")).connections;

  if (!connections.length) throw new Error("No Nango connections available to validate");

  let total = 0;
  const counts = new Map<string, number>();
  for (const conn of connections) {
    const model = conn.metadata?.model;
    if (!model) throw new Error(`${conn.id} is missing metadata.model for validation`);
    const count = await validateRecords(conn, model);
    total += count;
    counts.set(
      conn.metadata?.category ?? "uncategorized",
      (counts.get(conn.metadata?.category ?? "uncategorized") ?? 0) + count,
    );
  }

  if (!singleConnectionId) {
    const first = connections[0]!;
    await validateWebhooks(first, first.metadata!.model!);
  }

  console.log(`[nango-validate] base=${baseUrl} connections=${connections.length} records=${total}`);
  for (const [category, count] of counts.entries()) console.log(`${category.padEnd(12)} ${count}`);
}

main().catch((err: unknown) => {
  console.error("[nango-validate] failed");
  console.error(err);
  process.exit(1);
});
