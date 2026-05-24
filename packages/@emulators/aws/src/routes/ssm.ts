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
} from "../helpers.js";
import type { SsmParameter } from "../entities.js";

const TARGET_PREFIX = "AmazonSSM";

export function ssmRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const aws = () => getAwsStore(store);
  const accountId = getAccountId();
  const region = getDefaultRegion();

  const paramArn = (name: string) => `arn:aws:ssm:${region}:${accountId}:parameter/${name.replace(/^\//, "")}`;

  /** Resolves a parameter and optional `name:version` / `name:label` selector. */
  function resolve(reference: string): { param: SsmParameter; value: string; version: number } | undefined {
    const ref = reference.trim();
    const colon = ref.lastIndexOf(":");
    let name = ref;
    let selector = "";
    // A leading-slash name never has a meaningful colon before the path, so only
    // treat a trailing `:selector` as a version/label pointer.
    if (colon > 0 && !ref.slice(colon + 1).includes("/")) {
      name = ref.slice(0, colon);
      selector = ref.slice(colon + 1);
    }
    const param = aws().ssmParameters.findOneBy("name", name);
    if (!param) return undefined;
    if (!selector) return { param, value: param.value, version: param.version };

    const versions = aws().ssmParameterVersions.findBy("name", name);
    const byNumber = /^\d+$/.test(selector)
      ? versions.find((v) => v.version === Number(selector))
      : versions.find((v) => v.labels.includes(selector));
    if (!byNumber) return undefined;
    return { param, value: byNumber.value, version: byNumber.version };
  }

  function parameterPayload(name: string, value: string, type: string, version: number, p: SsmParameter) {
    return {
      Name: name,
      Type: type,
      Value: value,
      Version: version,
      LastModifiedDate: p.last_modified_date,
      ARN: p.arn,
      DataType: p.data_type,
    };
  }

  const handlers: Record<string, (c: Context<AppEnv>, input: Record<string, unknown>) => Response> = {
    PutParameter: (c, input) => {
      const name = strInput(input, "Name").trim();
      if (!name) return awsJsonError(c, "ValidationException", "Name is required.", 400);
      if (typeof input.Value !== "string") {
        return awsJsonError(c, "ValidationException", "Value is required.", 400);
      }
      const value = input.Value;
      const existing = aws().ssmParameters.findOneBy("name", name);
      const overwrite = boolInput(input, "Overwrite");
      if (existing && !overwrite) {
        return awsJsonError(c, "ParameterAlreadyExists", "The parameter already exists.", 400);
      }
      const type = (strInput(input, "Type") || existing?.type || "String") as SsmParameter["type"];
      const now = Math.floor(Date.now() / 1000);
      const version = existing ? existing.version + 1 : 1;
      const dataType = strInput(input, "DataType") || existing?.data_type || "text";
      if (existing) {
        aws().ssmParameters.update(existing.id, {
          value,
          type,
          version,
          last_modified_date: now,
          data_type: dataType,
          tier: strInput(input, "Tier") || existing.tier,
          key_id: strInput(input, "KeyId") || existing.key_id,
          description: strInput(input, "Description") || existing.description,
        });
      } else {
        aws().ssmParameters.insert({
          account_id: accountId,
          region,
          name,
          type,
          value,
          version,
          tier: strInput(input, "Tier") || "Standard",
          data_type: dataType,
          key_id: strInput(input, "KeyId"),
          description: strInput(input, "Description"),
          arn: paramArn(name),
          last_modified_date: now,
          tags: [],
        });
      }
      aws().ssmParameterVersions.insert({ name, version, value, type, labels: [], created_date: now });
      return awsJsonResponse(c, { Version: version, Tier: strInput(input, "Tier") || existing?.tier || "Standard" });
    },

    GetParameter: (c, input) => {
      const resolved = resolve(strInput(input, "Name"));
      if (!resolved) return paramNotFound(c);
      const { param, value, version } = resolved;
      return awsJsonResponse(c, { Parameter: parameterPayload(param.name, value, param.type, version, param) });
    },

    GetParameters: (c, input) => {
      const names = (Array.isArray(input.Names) ? input.Names : []) as string[];
      const found: unknown[] = [];
      const invalid: string[] = [];
      for (const n of names) {
        const r = resolve(n);
        if (r) found.push(parameterPayload(r.param.name, r.value, r.param.type, r.version, r.param));
        else invalid.push(n);
      }
      return awsJsonResponse(c, { Parameters: found, InvalidParameters: invalid });
    },

    GetParametersByPath: (c, input) => {
      const path = strInput(input, "Path") || "/";
      const recursive = boolInput(input, "Recursive");
      const all = aws().ssmParameters.all();
      const matched = all.filter((p) => {
        if (!p.name.startsWith(path)) return false;
        if (recursive) return true;
        const rest = p.name.slice(path.endsWith("/") ? path.length : path.length + 1);
        return !rest.includes("/");
      });
      return awsJsonResponse(c, {
        Parameters: matched.map((p) => parameterPayload(p.name, p.value, p.type, p.version, p)),
      });
    },

    DeleteParameter: (c, input) => {
      const name = strInput(input, "Name");
      const param = aws().ssmParameters.findOneBy("name", name);
      if (!param) return paramNotFound(c);
      for (const v of aws().ssmParameterVersions.findBy("name", name)) aws().ssmParameterVersions.delete(v.id);
      aws().ssmParameters.delete(param.id);
      return awsJsonResponse(c, {});
    },

    DeleteParameters: (c, input) => {
      const names = (Array.isArray(input.Names) ? input.Names : []) as string[];
      const deleted: string[] = [];
      const invalid: string[] = [];
      for (const n of names) {
        const param = aws().ssmParameters.findOneBy("name", n);
        if (param) {
          for (const v of aws().ssmParameterVersions.findBy("name", n)) aws().ssmParameterVersions.delete(v.id);
          aws().ssmParameters.delete(param.id);
          deleted.push(n);
        } else {
          invalid.push(n);
        }
      }
      return awsJsonResponse(c, { DeletedParameters: deleted, InvalidParameters: invalid });
    },

    DescribeParameters: (c) => {
      return awsJsonResponse(c, {
        Parameters: aws()
          .ssmParameters.all()
          .map((p) => ({
            Name: p.name,
            Type: p.type,
            Version: p.version,
            LastModifiedDate: p.last_modified_date,
            Tier: p.tier,
            DataType: p.data_type,
            Description: p.description || undefined,
          })),
      });
    },

    AddTagsToResource: (c, input) => {
      const param = aws().ssmParameters.findOneBy("name", strInput(input, "ResourceId"));
      if (!param) return paramNotFound(c);
      const incoming = (Array.isArray(input.Tags) ? input.Tags : []) as Array<{ Key: string; Value: string }>;
      const byKey = new Map(param.tags.map((t) => [t.Key, t.Value]));
      for (const t of incoming) byKey.set(t.Key, t.Value);
      aws().ssmParameters.update(param.id, { tags: [...byKey].map(([Key, Value]) => ({ Key, Value })) });
      return awsJsonResponse(c, {});
    },

    RemoveTagsFromResource: (c, input) => {
      const param = aws().ssmParameters.findOneBy("name", strInput(input, "ResourceId"));
      if (!param) return paramNotFound(c);
      const keys = new Set((Array.isArray(input.TagKeys) ? input.TagKeys : []) as string[]);
      aws().ssmParameters.update(param.id, { tags: param.tags.filter((t) => !keys.has(t.Key)) });
      return awsJsonResponse(c, {});
    },

    ListTagsForResource: (c, input) => {
      const param = aws().ssmParameters.findOneBy("name", strInput(input, "ResourceId"));
      if (!param) return paramNotFound(c);
      return awsJsonResponse(c, { TagList: param.tags });
    },
  };

  function paramNotFound(c: Context<AppEnv>): Response {
    return awsJsonError(c, "ParameterNotFound", "The parameter couldn't be found.", 400);
  }

  const dispatch = async (c: Context<AppEnv>) => {
    const target = c.req.header("X-Amz-Target") ?? "";
    const action = target.slice(target.lastIndexOf(".") + 1);
    const handler = handlers[action];
    if (!handler) {
      return awsJsonError(c, "UnknownOperationException", `ssm.${action} is not supported.`, 400);
    }
    return handler(c, await readJsonBody(c));
  };

  app.post("/", async (c, next) => {
    if (!(c.req.header("X-Amz-Target") ?? "").startsWith(TARGET_PREFIX + ".")) return next();
    return dispatch(c);
  });
  app.post("/ssm", dispatch);
  app.post("/ssm/", dispatch);
}
