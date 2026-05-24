// Direct AWS S3 (storage) tests — they drive `awsPlugin` in-process via a bare
// Hono app (no @emulators/nango / proxy / connection layer). Each `describe` is
// one red-green TDD feature filling a real S3 REST gap the emulator did not
// implement: query-string sub-resources (location, versioning, tagging,
// batch-delete) and the full multipart-upload lifecycle plus ranged GET. The
// existing handlers dispatch purely by route and ignore these `?subresource`
// query params, so every feature below is a genuine missing surface.
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createTestApp, testAuthHeaders as authHeaders, testBaseUrl as base } from "./helpers.js";

const auth = (extra?: Record<string, string>) => ({ ...authHeaders(), ...extra });

async function makeBucketWithObject(app: Hono) {
  await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
  await app.request(`${base}/test-bucket/file.txt`, {
    method: "PUT",
    headers: auth({ "Content-Type": "text/plain" }),
    body: "0123456789",
  });
}

describe("S3 direct — Feature 1: GET /:bucket?location (GetBucketLocation)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("returns a LocationConstraint", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const res = await app.request(`${base}/test-bucket?location`, { headers: auth() });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<LocationConstraint");
  });
});

describe("S3 direct — Feature 2: POST /:bucket/:key?uploads (CreateMultipartUpload)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("initiates a multipart upload and returns an UploadId", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const res = await app.request(`${base}/test-bucket/big.bin?uploads`, { method: "POST", headers: auth() });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<InitiateMultipartUploadResult");
    expect(xml).toMatch(/<UploadId>[^<]+<\/UploadId>/);
  });
});

describe("S3 direct — Feature 3: PUT /:bucket/:key?partNumber&uploadId (UploadPart)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("accepts a part and returns an ETag header", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const init = await app.request(`${base}/test-bucket/big.bin?uploads`, { method: "POST", headers: auth() });
    const uploadId = (await init.text()).match(/<UploadId>([^<]+)<\/UploadId>/)![1];

    const res = await app.request(`${base}/test-bucket/big.bin?partNumber=1&uploadId=${uploadId}`, {
      method: "PUT",
      headers: auth(),
      body: "AAAA",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBeTruthy();
  });
});

describe("S3 direct — Feature 4: GET /:bucket/:key?uploadId (ListParts)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("lists the parts uploaded so far", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const init = await app.request(`${base}/test-bucket/big.bin?uploads`, { method: "POST", headers: auth() });
    const uploadId = (await init.text()).match(/<UploadId>([^<]+)<\/UploadId>/)![1];
    await app.request(`${base}/test-bucket/big.bin?partNumber=1&uploadId=${uploadId}`, {
      method: "PUT",
      headers: auth(),
      body: "AAAA",
    });
    await app.request(`${base}/test-bucket/big.bin?partNumber=2&uploadId=${uploadId}`, {
      method: "PUT",
      headers: auth(),
      body: "BBBB",
    });

    const res = await app.request(`${base}/test-bucket/big.bin?uploadId=${uploadId}`, { headers: auth() });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<ListPartsResult");
    expect((xml.match(/<Part>/g) ?? []).length).toBe(2);
  });
});

describe("S3 direct — Feature 5: POST /:bucket/:key?uploadId (CompleteMultipartUpload)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("assembles the parts into a single retrievable object", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const init = await app.request(`${base}/test-bucket/big.bin?uploads`, { method: "POST", headers: auth() });
    const uploadId = (await init.text()).match(/<UploadId>([^<]+)<\/UploadId>/)![1];
    await app.request(`${base}/test-bucket/big.bin?partNumber=1&uploadId=${uploadId}`, {
      method: "PUT",
      headers: auth(),
      body: "Hello ",
    });
    await app.request(`${base}/test-bucket/big.bin?partNumber=2&uploadId=${uploadId}`, {
      method: "PUT",
      headers: auth(),
      body: "World",
    });

    const complete = await app.request(`${base}/test-bucket/big.bin?uploadId=${uploadId}`, {
      method: "POST",
      headers: auth({ "Content-Type": "application/xml" }),
      body: "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber></Part><Part><PartNumber>2</PartNumber></Part></CompleteMultipartUpload>",
    });
    expect(complete.status).toBe(200);
    expect(await complete.text()).toContain("<CompleteMultipartUploadResult");

    const get = await app.request(`${base}/test-bucket/big.bin`, { headers: auth() });
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("Hello World");
  });
});

describe("S3 direct — Feature 6: DELETE /:bucket/:key?uploadId (AbortMultipartUpload)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("aborts the upload so later ListParts 404s with NoSuchUpload", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const init = await app.request(`${base}/test-bucket/abort.bin?uploads`, { method: "POST", headers: auth() });
    const uploadId = (await init.text()).match(/<UploadId>([^<]+)<\/UploadId>/)![1];

    const abort = await app.request(`${base}/test-bucket/abort.bin?uploadId=${uploadId}`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(abort.status).toBe(204);

    const list = await app.request(`${base}/test-bucket/abort.bin?uploadId=${uploadId}`, { headers: auth() });
    expect(list.status).toBe(404);
    expect(await list.text()).toContain("NoSuchUpload");
  });
});

describe("S3 direct — Feature 7: POST /:bucket?delete (DeleteObjects batch)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("deletes multiple keys in one request", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    await app.request(`${base}/test-bucket/a.txt`, { method: "PUT", headers: auth(), body: "a" });
    await app.request(`${base}/test-bucket/b.txt`, { method: "PUT", headers: auth(), body: "b" });

    const res = await app.request(`${base}/test-bucket?delete`, {
      method: "POST",
      headers: auth({ "Content-Type": "application/xml" }),
      body: "<Delete><Object><Key>a.txt</Key></Object><Object><Key>b.txt</Key></Object></Delete>",
    });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<DeleteResult");
    expect((xml.match(/<Deleted>/g) ?? []).length).toBe(2);

    const a = await app.request(`${base}/test-bucket/a.txt`, { headers: auth() });
    expect(a.status).toBe(404);
  });
});

describe("S3 direct — Feature 8: PUT/GET /:bucket/:key?tagging (Object tagging)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("stores and returns the tag set", async () => {
    await makeBucketWithObject(app);
    const put = await app.request(`${base}/test-bucket/file.txt?tagging`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/xml" }),
      body: "<Tagging><TagSet><Tag><Key>env</Key><Value>prod</Value></Tag></TagSet></Tagging>",
    });
    expect(put.status).toBe(200);

    const get = await app.request(`${base}/test-bucket/file.txt?tagging`, { headers: auth() });
    expect(get.status).toBe(200);
    const xml = await get.text();
    expect(xml).toContain("<Key>env</Key>");
    expect(xml).toContain("<Value>prod</Value>");
  });
});

describe("S3 direct — Feature 9: GET /:bucket/:key with Range header", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("returns 206 Partial Content with a Content-Range", async () => {
    await makeBucketWithObject(app);
    const res = await app.request(`${base}/test-bucket/file.txt`, {
      headers: auth({ Range: "bytes=0-3" }),
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-3/10");
    expect(await res.text()).toBe("0123");
  });
});

describe("S3 direct — Feature 10: PUT/GET /:bucket?versioning (Bucket versioning)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("enables versioning and reflects it on read", async () => {
    await app.request(`${base}/test-bucket`, { method: "PUT", headers: auth() });
    const put = await app.request(`${base}/test-bucket?versioning`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/xml" }),
      body: "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>",
    });
    expect(put.status).toBe(200);

    const get = await app.request(`${base}/test-bucket?versioning`, { headers: auth() });
    expect(get.status).toBe(200);
    expect(await get.text()).toContain("<Status>Enabled</Status>");
  });
});
