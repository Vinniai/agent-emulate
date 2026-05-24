// AWS cloud emulator — S3 objects + SQS messaging.
//
// S3 is pure REST (XML responses); SQS/IAM/STS use the query protocol
// (form-encoded `Action=` POSTs). Auth is a simple bearer token here, not
// SigV4. Flow: list buckets, round-trip an object, then send and receive an
// SQS message.
//
//   pnpm --filter api-emulators-quickstart aws
import { awsPlugin, seedFromConfig } from "@emulators/aws";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4100";

async function main(): Promise<void> {
  const emu = mount(awsPlugin, BASE, {
    fallbackUser: { login: "admin", id: 1, scopes: ["s3:*", "sqs:*", "iam:*", "sts:*"] },
  });

  seedFromConfig(emu.store, BASE, {
    region: "us-east-1",
    s3: { buckets: [{ name: "acme-uploads" }] },
    sqs: { queues: [{ name: "acme-events" }] },
  });

  const auth = { Authorization: "Bearer aws_dev" };
  const sqs = (params: Record<string, string>): RequestInit => ({
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  heading("AWS S3 — buckets & objects");

  await call(emu, "List buckets (XML)", `${BASE}/`, { headers: auth });

  await call(emu, "Put an object", `${BASE}/acme-uploads/reports/q3.txt`, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "text/plain" },
    body: "Q3 revenue: up 18%\n",
  });

  await call(emu, "Get the object back", `${BASE}/acme-uploads/reports/q3.txt`, { headers: auth });
  await call(emu, "List objects under a prefix", `${BASE}/acme-uploads?prefix=reports/`, { headers: auth });

  heading("AWS SQS — queue messaging");

  const urlXml = (await call(
    emu,
    "GetQueueUrl",
    `${BASE}/sqs/`,
    sqs({
      Action: "GetQueueUrl",
      QueueName: "acme-events",
    }),
  )) as string;
  const queueUrl = /<QueueUrl>(.*?)<\/QueueUrl>/.exec(urlXml)?.[1] ?? "";

  await call(
    emu,
    "SendMessage",
    `${BASE}/sqs/`,
    sqs({
      Action: "SendMessage",
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ type: "order.created", id: "ord_123" }),
    }),
  );

  await call(
    emu,
    "ReceiveMessage",
    `${BASE}/sqs/`,
    sqs({
      Action: "ReceiveMessage",
      QueueUrl: queueUrl,
      MaxNumberOfMessages: "1",
    }),
  );

  console.log("\n✅ AWS demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
