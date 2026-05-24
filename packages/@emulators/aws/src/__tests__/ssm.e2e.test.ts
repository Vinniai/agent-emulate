import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
  GetParametersCommand,
  GetParametersByPathCommand,
  DeleteParameterCommand,
  DescribeParametersCommand,
  AddTagsToResourceCommand,
  ListTagsForResourceCommand,
} from "@aws-sdk/client-ssm";
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

describe("SSM Parameter Store — official AWS SDK", () => {
  let handle: EmulatorHandle;
  let ssm: SSMClient;

  beforeAll(async () => {
    handle = await startEmulator();
    ssm = new SSMClient({
      endpoint: handle.url,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
  });

  afterAll(async () => {
    ssm.destroy();
    await handle.close();
  });

  it("puts and gets a parameter", async () => {
    const put = await ssm.send(new PutParameterCommand({ Name: "/app/db/url", Value: "postgres://x", Type: "String" }));
    expect(put.Version).toBe(1);

    const got = await ssm.send(new GetParameterCommand({ Name: "/app/db/url" }));
    expect(got.Parameter?.Value).toBe("postgres://x");
    expect(got.Parameter?.ARN).toContain(":parameter/app/db/url");
  });

  it("rejects overwrite without the Overwrite flag, then bumps version with it", async () => {
    await ssm.send(new PutParameterCommand({ Name: "/app/key", Value: "v1", Type: "String" }));
    await expect(
      ssm.send(new PutParameterCommand({ Name: "/app/key", Value: "v2", Type: "String" })),
    ).rejects.toMatchObject({ name: "ParameterAlreadyExists" });

    const put = await ssm.send(
      new PutParameterCommand({ Name: "/app/key", Value: "v2", Type: "String", Overwrite: true }),
    );
    expect(put.Version).toBe(2);

    const v1 = await ssm.send(new GetParameterCommand({ Name: "/app/key:1" }));
    expect(v1.Parameter?.Value).toBe("v1");
  });

  it("batch GetParameters reports invalid names", async () => {
    await ssm.send(new PutParameterCommand({ Name: "/batch/a", Value: "1", Type: "String" }));
    const res = await ssm.send(new GetParametersCommand({ Names: ["/batch/a", "/batch/missing"] }));
    expect(res.Parameters?.length).toBe(1);
    expect(res.InvalidParameters).toEqual(["/batch/missing"]);
  });

  it("GetParametersByPath honors non-recursive vs recursive", async () => {
    await ssm.send(new PutParameterCommand({ Name: "/tree/one", Value: "1", Type: "String" }));
    await ssm.send(new PutParameterCommand({ Name: "/tree/sub/two", Value: "2", Type: "String" }));

    const shallow = await ssm.send(new GetParametersByPathCommand({ Path: "/tree" }));
    expect(shallow.Parameters?.map((p) => p.Name)).toEqual(["/tree/one"]);

    const deep = await ssm.send(new GetParametersByPathCommand({ Path: "/tree", Recursive: true }));
    expect(deep.Parameters?.length).toBe(2);
  });

  it("tags, describes and deletes", async () => {
    await ssm.send(new PutParameterCommand({ Name: "/tagged", Value: "x", Type: "String" }));
    await ssm.send(
      new AddTagsToResourceCommand({
        ResourceType: "Parameter",
        ResourceId: "/tagged",
        Tags: [{ Key: "team", Value: "core" }],
      }),
    );
    const tags = await ssm.send(new ListTagsForResourceCommand({ ResourceType: "Parameter", ResourceId: "/tagged" }));
    expect(tags.TagList).toEqual([{ Key: "team", Value: "core" }]);

    const described = await ssm.send(new DescribeParametersCommand({}));
    expect(described.Parameters?.some((p) => p.Name === "/tagged")).toBe(true);

    await ssm.send(new DeleteParameterCommand({ Name: "/tagged" }));
    await expect(ssm.send(new GetParameterCommand({ Name: "/tagged" }))).rejects.toMatchObject({
      name: "ParameterNotFound",
    });
  });
});
