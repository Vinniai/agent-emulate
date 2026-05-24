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
  numInput,
} from "../helpers.js";
import type { KmsKey } from "../entities.js";

const TARGET_PREFIX = "TrentService";

interface CiphertextEnvelope {
  v: number;
  key_id: string;
  plaintext: string;
  alg: string;
}

function encodeCiphertext(keyId: string, alg: string, plaintextB64: string): string {
  const envelope: CiphertextEnvelope = { v: 1, key_id: keyId, plaintext: plaintextB64, alg };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

function decodeCiphertext(blobB64: string): CiphertextEnvelope | null {
  try {
    const json = Buffer.from(blobB64, "base64").toString("utf8");
    const env = JSON.parse(json) as CiphertextEnvelope;
    if (env.v !== 1 || !env.key_id || !env.plaintext) return null;
    return env;
  } catch {
    return null;
  }
}

export function kmsRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const aws = () => getAwsStore(store);
  const accountId = getAccountId();
  const region = getDefaultRegion();

  const keyArn = (keyId: string) => `arn:aws:kms:${region}:${accountId}:key/${keyId}`;
  const aliasArn = (name: string) => `arn:aws:kms:${region}:${accountId}:${name}`;

  function resolveKey(identifier: string): KmsKey | undefined {
    const id = identifier.trim();
    if (!id) return undefined;
    // Alias ARN or bare alias name -> follow to target key.
    if (id.startsWith("alias/") || id.includes(":alias/")) {
      const aliasName = id.startsWith("alias/") ? id : id.slice(id.indexOf(":alias/") + 1);
      const alias = aws().kmsAliases.findOneBy("alias_name", aliasName);
      if (!alias) return undefined;
      return aws().kmsKeys.findOneBy("key_id", alias.target_key_id);
    }
    // Key ARN -> extract the trailing key id.
    const keyId = id.includes(":key/") ? id.slice(id.indexOf(":key/") + ":key/".length) : id;
    return aws().kmsKeys.findOneBy("key_id", keyId);
  }

  function keyMetadata(key: KmsKey): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      AWSAccountId: key.account_id,
      KeyId: key.key_id,
      Arn: key.arn,
      CreationDate: key.creation_date,
      Enabled: key.enabled,
      KeyUsage: key.key_usage,
      KeyState: key.key_state,
      Origin: key.origin,
      KeyManager: key.key_manager,
      CustomerMasterKeySpec: key.customer_master_key_spec,
      KeySpec: key.key_spec,
      EncryptionAlgorithms: ["SYMMETRIC_DEFAULT"],
      MultiRegion: key.multi_region,
    };
    if (key.description) meta.Description = key.description;
    if (key.deletion_date) meta.DeletionDate = key.deletion_date;
    return meta;
  }

  const handlers: Record<string, (c: Context<AppEnv>, input: Record<string, unknown>) => Response | Promise<Response>> =
    {
      CreateKey: (c, input) => {
        const keyId = randomUUID();
        const now = Math.floor(Date.now() / 1000);
        const key = aws().kmsKeys.insert({
          account_id: accountId,
          region,
          key_id: keyId,
          arn: keyArn(keyId),
          creation_date: now,
          enabled: true,
          key_usage: strInput(input, "KeyUsage", "keyUsage") || "ENCRYPT_DECRYPT",
          key_state: "Enabled",
          origin: strInput(input, "Origin", "origin") || "AWS_KMS",
          key_manager: "CUSTOMER",
          customer_master_key_spec: strInput(input, "KeySpec", "CustomerMasterKeySpec") || "SYMMETRIC_DEFAULT",
          key_spec: strInput(input, "KeySpec", "keySpec") || "SYMMETRIC_DEFAULT",
          multi_region: false,
          description: strInput(input, "Description", "description"),
        });
        return awsJsonResponse(c, { KeyMetadata: keyMetadata(key) });
      },

      DescribeKey: (c, input) => {
        const key = resolveKey(strInput(input, "KeyId", "keyId"));
        if (!key) return awsJsonError(c, "NotFoundException", "Key not found.", 400);
        return awsJsonResponse(c, { KeyMetadata: keyMetadata(key) });
      },

      ListKeys: (c) => {
        const keys = aws().kmsKeys.all();
        return awsJsonResponse(c, {
          Keys: keys.map((k) => ({ KeyId: k.key_id, KeyArn: k.arn })),
          Truncated: false,
        });
      },

      CreateAlias: (c, input) => {
        const aliasName = strInput(input, "AliasName", "aliasName");
        const targetKeyId = strInput(input, "TargetKeyId", "targetKeyId");
        if (!aliasName.startsWith("alias/")) {
          return awsJsonError(c, "ValidationException", "AliasName must start with 'alias/'.", 400);
        }
        const key = resolveKey(targetKeyId);
        if (!key) return awsJsonError(c, "NotFoundException", "Target key not found.", 400);
        if (aws().kmsAliases.findOneBy("alias_name", aliasName)) {
          return awsJsonError(c, "AlreadyExistsException", "An alias with this name already exists.", 400);
        }
        aws().kmsAliases.insert({
          account_id: accountId,
          region,
          alias_name: aliasName,
          alias_arn: aliasArn(aliasName),
          target_key_id: key.key_id,
          creation_date: Math.floor(Date.now() / 1000),
        });
        return awsJsonResponse(c, {});
      },

      ListAliases: (c, input) => {
        const filterKeyId = strInput(input, "KeyId", "keyId");
        let aliases = aws().kmsAliases.all();
        if (filterKeyId) {
          const key = resolveKey(filterKeyId);
          aliases = key ? aliases.filter((a) => a.target_key_id === key.key_id) : [];
        }
        return awsJsonResponse(c, {
          Aliases: aliases.map((a) => ({
            AliasName: a.alias_name,
            AliasArn: a.alias_arn,
            TargetKeyId: a.target_key_id,
            CreationDate: a.creation_date,
            LastUpdatedDate: a.creation_date,
          })),
          Truncated: false,
        });
      },

      Encrypt: (c, input) => {
        const key = resolveKey(strInput(input, "KeyId", "keyId"));
        if (!key) return awsJsonError(c, "NotFoundException", "Key not found.", 400);
        if (!key.enabled) return awsJsonError(c, "DisabledException", "Key is disabled.", 400);
        const plaintext = strInput(input, "Plaintext", "plaintext");
        if (!plaintext) return awsJsonError(c, "ValidationException", "Plaintext is required.", 400);
        const alg = strInput(input, "EncryptionAlgorithm") || "SYMMETRIC_DEFAULT";
        return awsJsonResponse(c, {
          CiphertextBlob: encodeCiphertext(key.key_id, alg, plaintext),
          KeyId: key.arn,
          EncryptionAlgorithm: alg,
        });
      },

      Decrypt: (c, input) => {
        const blob = strInput(input, "CiphertextBlob", "ciphertextBlob");
        const envelope = blob ? decodeCiphertext(blob) : null;
        if (!envelope) {
          return awsJsonError(c, "InvalidCiphertextException", "Invalid local KMS ciphertext.", 400);
        }
        const key = aws().kmsKeys.findOneBy("key_id", envelope.key_id);
        if (!key) return awsJsonError(c, "NotFoundException", "Key not found.", 400);
        if (!key.enabled) return awsJsonError(c, "DisabledException", "Key is disabled.", 400);
        const requested = strInput(input, "KeyId", "keyId");
        if (requested) {
          const reqKey = resolveKey(requested);
          if (!reqKey || reqKey.key_id !== key.key_id) {
            return awsJsonError(c, "IncorrectKeyException", "CiphertextBlob was encrypted with a different key.", 400);
          }
        }
        return awsJsonResponse(c, {
          KeyId: key.arn,
          Plaintext: envelope.plaintext,
          EncryptionAlgorithm: envelope.alg || "SYMMETRIC_DEFAULT",
        });
      },

      GenerateDataKey: (c, input) => {
        const key = resolveKey(strInput(input, "KeyId", "keyId"));
        if (!key) return awsJsonError(c, "NotFoundException", "Key not found.", 400);
        if (!key.enabled) return awsJsonError(c, "DisabledException", "Key is disabled.", 400);
        const spec = strInput(input, "KeySpec", "keySpec");
        const bytes = numInput(input, "NumberOfBytes") ?? (spec === "AES_128" ? 16 : 32);
        if (bytes < 1 || bytes > 1024) {
          return awsJsonError(c, "ValidationException", "NumberOfBytes must be between 1 and 1024.", 400);
        }
        const plaintextB64 = Buffer.from(randomUUID().repeat(2)).subarray(0, bytes).toString("base64");
        return awsJsonResponse(c, {
          CiphertextBlob: encodeCiphertext(key.key_id, "SYMMETRIC_DEFAULT", plaintextB64),
          Plaintext: plaintextB64,
          KeyId: key.arn,
        });
      },
    };

  const dispatch = async (c: Context<AppEnv>) => {
    const target = c.req.header("X-Amz-Target") ?? "";
    const action = target.slice(target.lastIndexOf(".") + 1);
    const handler = handlers[action];
    if (!handler) {
      return awsJsonError(c, "UnknownOperationException", `kms.${action} is not supported.`, 400);
    }
    const input = await readJsonBody(c);
    return handler(c, input);
  };

  // Mounted at the root (canonical AWS endpoint) keyed on X-Amz-Target, plus an
  // explicit /kms prefix for path-style endpoints. Falls through when the target
  // belongs to another JSON service.
  app.post("/", async (c, next) => {
    if (!(c.req.header("X-Amz-Target") ?? "").startsWith(TARGET_PREFIX + ".")) return next();
    return dispatch(c);
  });
  app.post("/kms", dispatch);
  app.post("/kms/", dispatch);
}
