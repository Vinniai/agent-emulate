import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import {
  KMSClient,
  CreateKeyCommand,
  DescribeKeyCommand,
  ListKeysCommand,
  CreateAliasCommand,
  ListAliasesCommand,
  EncryptCommand,
  DecryptCommand,
  GenerateDataKeyCommand,
} from "@aws-sdk/client-kms";
import { createTestApp } from "./helpers.js";

type EmulatorHandle = { url: string; close: () => Promise<void> };

async function startEmulator(): Promise<EmulatorHandle> {
  const { app } = createTestApp();
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("KMS — official AWS SDK", () => {
  let handle: EmulatorHandle;
  let kms: KMSClient;

  beforeAll(async () => {
    handle = await startEmulator();
    kms = new KMSClient({
      endpoint: handle.url,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  });

  afterAll(async () => {
    kms.destroy();
    await handle.close();
  });

  it("creates and describes a key", async () => {
    const created = await kms.send(new CreateKeyCommand({ Description: "demo key" }));
    expect(created.KeyMetadata?.KeyId).toBeTruthy();
    expect(created.KeyMetadata?.Arn).toContain(":key/");
    expect(created.KeyMetadata?.Enabled).toBe(true);

    const keyId = created.KeyMetadata!.KeyId!;
    const described = await kms.send(new DescribeKeyCommand({ KeyId: keyId }));
    expect(described.KeyMetadata?.Description).toBe("demo key");
    expect(described.KeyMetadata?.KeyState).toBe("Enabled");
  });

  it("lists keys", async () => {
    await kms.send(new CreateKeyCommand({}));
    const list = await kms.send(new ListKeysCommand({}));
    expect(list.Keys?.length ?? 0).toBeGreaterThan(0);
    expect(list.Keys?.[0]?.KeyArn).toContain(":key/");
  });

  it("creates an alias and resolves it on describe", async () => {
    const created = await kms.send(new CreateKeyCommand({}));
    const keyId = created.KeyMetadata!.KeyId!;
    await kms.send(new CreateAliasCommand({ AliasName: "alias/my-app", TargetKeyId: keyId }));

    const aliases = await kms.send(new ListAliasesCommand({}));
    const found = aliases.Aliases?.find((a) => a.AliasName === "alias/my-app");
    expect(found?.TargetKeyId).toBe(keyId);

    const described = await kms.send(new DescribeKeyCommand({ KeyId: "alias/my-app" }));
    expect(described.KeyMetadata?.KeyId).toBe(keyId);
  });

  it("round-trips encrypt -> decrypt", async () => {
    const created = await kms.send(new CreateKeyCommand({}));
    const keyId = created.KeyMetadata!.KeyId!;
    const plaintext = new TextEncoder().encode("super-secret");

    const enc = await kms.send(new EncryptCommand({ KeyId: keyId, Plaintext: plaintext }));
    expect(enc.CiphertextBlob).toBeTruthy();
    expect(enc.KeyId).toContain(":key/");

    const dec = await kms.send(new DecryptCommand({ CiphertextBlob: enc.CiphertextBlob }));
    expect(new TextDecoder().decode(dec.Plaintext)).toBe("super-secret");
  });

  it("generates a data key with plaintext and ciphertext", async () => {
    const created = await kms.send(new CreateKeyCommand({}));
    const keyId = created.KeyMetadata!.KeyId!;
    const dk = await kms.send(new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: "AES_256" }));
    expect(dk.Plaintext?.length).toBe(32);
    expect(dk.CiphertextBlob).toBeTruthy();

    const dec = await kms.send(new DecryptCommand({ CiphertextBlob: dk.CiphertextBlob }));
    expect(dec.Plaintext?.length).toBe(32);
  });

  it("returns NotFoundException for an unknown key", async () => {
    await expect(
      kms.send(new DescribeKeyCommand({ KeyId: "00000000-0000-0000-0000-000000000000" })),
    ).rejects.toMatchObject({ name: "NotFoundException" });
  });
});
