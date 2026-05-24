import { randomUUID } from "crypto";
import type { Context } from "hono";
import type { AppEnv, RouteContext } from "@emulators/core";
import { getAwsStore } from "../store.js";
import {
  getAccountId,
  getDefaultRegion,
  awsJsonResponse,
  awsJsonError,
  readJsonBody,
  strInput,
  boolInput,
  shortSuffix,
} from "../helpers.js";
import type { Secret, SecretVersion } from "../entities.js";

const TARGET_PREFIX = "secretsmanager";

export function secretsManagerRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const aws = () => getAwsStore(store);
  const accountId = getAccountId();
  const region = getDefaultRegion();

  function findSecret(secretId: string): Secret | undefined {
    const id = secretId.trim();
    if (!id) return undefined;
    return (
      aws().secrets.findOneBy("arn", id) ??
      aws().secrets.findOneBy("name", id) ??
      aws()
        .secrets.all()
        .find((s) => s.arn.startsWith(id))
    );
  }

  function versionsOf(secretArn: string): SecretVersion[] {
    return aws().secretVersions.findBy("secret_arn", secretArn);
  }

  /** Makes `versionId` the sole AWSCURRENT, demoting the prior current to AWSPREVIOUS. */
  function promoteToCurrent(secretArn: string, versionId: string): void {
    for (const v of versionsOf(secretArn)) {
      const stages = new Set(v.version_stages);
      if (v.version_id === versionId) continue;
      if (stages.has("AWSCURRENT")) {
        stages.delete("AWSCURRENT");
        stages.add("AWSPREVIOUS");
      } else {
        stages.delete("AWSPREVIOUS");
      }
      aws().secretVersions.update(v.id, { version_stages: [...stages] });
    }
  }

  function addVersion(
    secret: Secret,
    versionId: string,
    secretString: string | undefined,
    secretBinary: string | undefined,
    stages: string[],
  ): SecretVersion {
    const version = aws().secretVersions.insert({
      secret_arn: secret.arn,
      version_id: versionId,
      secret_string: secretString,
      secret_binary: secretBinary,
      version_stages: stages,
      created_date: Math.floor(Date.now() / 1000),
    });
    if (stages.includes("AWSCURRENT")) promoteToCurrent(secret.arn, versionId);
    aws().secrets.update(secret.id, { last_changed_date: Math.floor(Date.now() / 1000) });
    return version;
  }

  const handlers: Record<string, (c: Context<AppEnv>, input: Record<string, unknown>) => Response> = {
    CreateSecret: (c, input) => {
      const name = strInput(input, "Name").trim();
      if (!name) return awsJsonError(c, "InvalidParameterException", "Name is required.", 400);
      if (findSecret(name)) {
        return awsJsonError(c, "ResourceExistsException", "The secret already exists.", 400);
      }
      const arn = `arn:aws:secretsmanager:${region}:${accountId}:secret:${name}-${shortSuffix()}`;
      const now = Math.floor(Date.now() / 1000);
      const tags = (Array.isArray(input.Tags) ? input.Tags : []) as Array<{ Key: string; Value: string }>;
      const secret = aws().secrets.insert({
        account_id: accountId,
        region,
        arn,
        name,
        description: strInput(input, "Description"),
        kms_key_id: strInput(input, "KmsKeyId"),
        tags,
        created_date: now,
        last_changed_date: now,
      });
      const versionId = strInput(input, "ClientRequestToken") || randomUUID();
      addVersion(secret, versionId, optionalStr(input, "SecretString"), optionalStr(input, "SecretBinary"), [
        "AWSCURRENT",
      ]);
      return awsJsonResponse(c, { ARN: arn, Name: name, VersionId: versionId });
    },

    GetSecretValue: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      if (secret.deleted_date) {
        return awsJsonError(c, "InvalidRequestException", "Secret is scheduled for deletion.", 400);
      }
      const versionId = strInput(input, "VersionId");
      const stage = strInput(input, "VersionStage") || "AWSCURRENT";
      const versions = versionsOf(secret.arn);
      const version = versionId
        ? versions.find((v) => v.version_id === versionId)
        : versions.find((v) => v.version_stages.includes(stage));
      if (!version) {
        return awsJsonError(c, "ResourceNotFoundException", "No matching version found.", 400);
      }
      return awsJsonResponse(c, {
        ARN: secret.arn,
        Name: secret.name,
        VersionId: version.version_id,
        ...(version.secret_string !== undefined ? { SecretString: version.secret_string } : {}),
        ...(version.secret_binary !== undefined ? { SecretBinary: version.secret_binary } : {}),
        VersionStages: version.version_stages,
        CreatedDate: version.created_date,
      });
    },

    PutSecretValue: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      const versionId = strInput(input, "ClientRequestToken") || randomUUID();
      const stages = (Array.isArray(input.VersionStages) ? (input.VersionStages as string[]) : ["AWSCURRENT"]).filter(
        (s) => typeof s === "string",
      );
      const version = addVersion(
        secret,
        versionId,
        optionalStr(input, "SecretString"),
        optionalStr(input, "SecretBinary"),
        stages.length ? stages : ["AWSCURRENT"],
      );
      return awsJsonResponse(c, {
        ARN: secret.arn,
        Name: secret.name,
        VersionId: version.version_id,
        VersionStages: version.version_stages,
      });
    },

    UpdateSecret: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      const patch: Partial<Secret> = { last_changed_date: Math.floor(Date.now() / 1000) };
      if (typeof input.Description === "string") patch.description = input.Description;
      if (typeof input.KmsKeyId === "string") patch.kms_key_id = input.KmsKeyId;
      aws().secrets.update(secret.id, patch);
      let versionId: string | undefined;
      if (input.SecretString !== undefined || input.SecretBinary !== undefined) {
        versionId = strInput(input, "ClientRequestToken") || randomUUID();
        addVersion(secret, versionId, optionalStr(input, "SecretString"), optionalStr(input, "SecretBinary"), [
          "AWSCURRENT",
        ]);
      }
      return awsJsonResponse(c, { ARN: secret.arn, Name: secret.name, ...(versionId ? { VersionId: versionId } : {}) });
    },

    DeleteSecret: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      const force = boolInput(input, "ForceDeleteWithoutRecovery");
      if (force) {
        for (const v of versionsOf(secret.arn)) aws().secretVersions.delete(v.id);
        aws().secrets.delete(secret.id);
        return awsJsonResponse(c, { ARN: secret.arn, Name: secret.name, DeletionDate: Math.floor(Date.now() / 1000) });
      }
      const days = typeof input.RecoveryWindowInDays === "number" ? input.RecoveryWindowInDays : 30;
      const deletionDate = Math.floor(Date.now() / 1000) + days * 86400;
      aws().secrets.update(secret.id, { deleted_date: deletionDate });
      return awsJsonResponse(c, { ARN: secret.arn, Name: secret.name, DeletionDate: deletionDate });
    },

    RestoreSecret: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      aws().secrets.update(secret.id, { deleted_date: undefined });
      return awsJsonResponse(c, { ARN: secret.arn, Name: secret.name });
    },

    ListSecrets: (c) => {
      const secrets = aws().secrets.all();
      return awsJsonResponse(c, {
        SecretList: secrets.map((s) => ({
          ARN: s.arn,
          Name: s.name,
          Description: s.description,
          KmsKeyId: s.kms_key_id || undefined,
          Tags: s.tags,
          CreatedDate: s.created_date,
          LastChangedDate: s.last_changed_date,
          ...(s.deleted_date ? { DeletedDate: s.deleted_date } : {}),
        })),
      });
    },

    DescribeSecret: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      const versionIdsToStages: Record<string, string[]> = {};
      for (const v of versionsOf(secret.arn)) versionIdsToStages[v.version_id] = v.version_stages;
      return awsJsonResponse(c, {
        ARN: secret.arn,
        Name: secret.name,
        Description: secret.description,
        KmsKeyId: secret.kms_key_id || undefined,
        Tags: secret.tags,
        CreatedDate: secret.created_date,
        LastChangedDate: secret.last_changed_date,
        VersionIdsToStages: versionIdsToStages,
        ...(secret.deleted_date ? { DeletedDate: secret.deleted_date } : {}),
      });
    },

    TagResource: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      const incoming = (Array.isArray(input.Tags) ? input.Tags : []) as Array<{ Key: string; Value: string }>;
      const byKey = new Map(secret.tags.map((t) => [t.Key, t.Value]));
      for (const t of incoming) byKey.set(t.Key, t.Value);
      aws().secrets.update(secret.id, { tags: [...byKey].map(([Key, Value]) => ({ Key, Value })) });
      return awsJsonResponse(c, {});
    },

    UntagResource: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      const keys = new Set((Array.isArray(input.TagKeys) ? input.TagKeys : []) as string[]);
      aws().secrets.update(secret.id, { tags: secret.tags.filter((t) => !keys.has(t.Key)) });
      return awsJsonResponse(c, {});
    },

    ListSecretVersionIds: (c, input) => {
      const secret = findSecret(strInput(input, "SecretId"));
      if (!secret) return notFound(c);
      return awsJsonResponse(c, {
        ARN: secret.arn,
        Name: secret.name,
        Versions: versionsOf(secret.arn).map((v) => ({
          VersionId: v.version_id,
          VersionStages: v.version_stages,
          CreatedDate: v.created_date,
        })),
      });
    },
  };

  function notFound(c: Context<AppEnv>): Response {
    return awsJsonError(c, "ResourceNotFoundException", "Secrets Manager can't find the specified secret.", 400);
  }

  const dispatch = async (c: Context<AppEnv>) => {
    const target = c.req.header("X-Amz-Target") ?? "";
    const action = target.slice(target.lastIndexOf(".") + 1);
    const handler = handlers[action];
    if (!handler) {
      return awsJsonError(c, "UnknownOperationException", `secretsmanager.${action} is not supported.`, 400);
    }
    return handler(c, await readJsonBody(c));
  };

  app.post("/", async (c, next) => {
    if (!(c.req.header("X-Amz-Target") ?? "").startsWith(TARGET_PREFIX + ".")) return next();
    return dispatch(c);
  });
  app.post("/secretsmanager", dispatch);
  app.post("/secretsmanager/", dispatch);
}

function optionalStr(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? (input[key] as string) : undefined;
}
