import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretCommand,
  DescribeSecretCommand,
  ListSecretsCommand,
  ListSecretVersionIdsCommand,
  DeleteSecretCommand,
  RestoreSecretCommand,
  TagResourceCommand,
} from "@aws-sdk/client-secrets-manager";
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
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe("Secrets Manager — official AWS SDK", () => {
  let handle: EmulatorHandle;
  let sm: SecretsManagerClient;

  beforeAll(async () => {
    handle = await startEmulator();
    sm = new SecretsManagerClient({
      endpoint: handle.url,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  });

  afterAll(async () => {
    sm.destroy();
    await handle.close();
  });

  it("creates and reads a secret value", async () => {
    const created = await sm.send(
      new CreateSecretCommand({ Name: "db/password", SecretString: "hunter2", Description: "db pw" }),
    );
    expect(created.ARN).toContain(":secret:db/password-");
    expect(created.VersionId).toBeTruthy();

    const value = await sm.send(new GetSecretValueCommand({ SecretId: "db/password" }));
    expect(value.SecretString).toBe("hunter2");
    expect(value.VersionStages).toContain("AWSCURRENT");
  });

  it("rotates the current version on PutSecretValue and keeps AWSPREVIOUS", async () => {
    await sm.send(new CreateSecretCommand({ Name: "api/key", SecretString: "v1" }));
    const put = await sm.send(new PutSecretValueCommand({ SecretId: "api/key", SecretString: "v2" }));
    expect(put.VersionStages).toContain("AWSCURRENT");

    const current = await sm.send(new GetSecretValueCommand({ SecretId: "api/key" }));
    expect(current.SecretString).toBe("v2");

    const previous = await sm.send(new GetSecretValueCommand({ SecretId: "api/key", VersionStage: "AWSPREVIOUS" }));
    expect(previous.SecretString).toBe("v1");

    const versions = await sm.send(new ListSecretVersionIdsCommand({ SecretId: "api/key" }));
    expect(versions.Versions?.length).toBe(2);
  });

  it("updates description and resolves by full ARN", async () => {
    const created = await sm.send(new CreateSecretCommand({ Name: "svc/token", SecretString: "abc" }));
    await sm.send(new UpdateSecretCommand({ SecretId: created.ARN, Description: "updated" }));
    const described = await sm.send(new DescribeSecretCommand({ SecretId: created.ARN }));
    expect(described.Description).toBe("updated");
    expect(Object.keys(described.VersionIdsToStages ?? {}).length).toBeGreaterThan(0);
  });

  it("tags, lists, deletes and restores", async () => {
    await sm.send(new CreateSecretCommand({ Name: "taggable", SecretString: "x" }));
    await sm.send(new TagResourceCommand({ SecretId: "taggable", Tags: [{ Key: "env", Value: "prod" }] }));
    const described = await sm.send(new DescribeSecretCommand({ SecretId: "taggable" }));
    expect(described.Tags).toEqual([{ Key: "env", Value: "prod" }]);

    const list = await sm.send(new ListSecretsCommand({}));
    expect(list.SecretList?.some((s) => s.Name === "taggable")).toBe(true);

    const del = await sm.send(new DeleteSecretCommand({ SecretId: "taggable" }));
    expect(del.DeletionDate).toBeTruthy();
    await expect(sm.send(new GetSecretValueCommand({ SecretId: "taggable" }))).rejects.toMatchObject({
      name: "InvalidRequestException",
    });

    await sm.send(new RestoreSecretCommand({ SecretId: "taggable" }));
    const restored = await sm.send(new GetSecretValueCommand({ SecretId: "taggable" }));
    expect(restored.SecretString).toBe("x");
  });

  it("throws ResourceNotFoundException for unknown secret", async () => {
    await expect(sm.send(new GetSecretValueCommand({ SecretId: "nope" }))).rejects.toMatchObject({
      name: "ResourceNotFoundException",
    });
  });
});
