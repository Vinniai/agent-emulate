import type { RouteContext } from "@emulators/core";
import { uptickError } from "../helpers.js";

const RESOURCE_OPTIONS: Record<
  string,
  {
    type: string;
    methods: string[];
    fields: Record<string, { type: string; required?: boolean; relationship?: string }>;
  }
> = {
  clients: {
    type: "Client",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    fields: {
      name: { type: "string", required: true },
      is_active: { type: "boolean" },
      sector: { type: "string" },
      ref: { type: "string" },
      contact_name: { type: "string" },
      contact_email: { type: "string" },
    },
  },
  properties: {
    type: "Property",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    fields: {
      name: { type: "string", required: true },
      is_active: { type: "boolean" },
      address: { type: "object" },
      client: { type: "relationship", relationship: "Client" },
    },
  },
  assets: {
    type: "Asset",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    fields: {
      name: { type: "string", required: true },
      asset_number: { type: "string" },
      barcode: { type: "string" },
      standard_maintenance: { type: "string" },
      property: { type: "relationship", relationship: "Property" },
      client: { type: "relationship", relationship: "Client" },
      asset_type: { type: "relationship", relationship: "AssetType" },
    },
  },
  defects: {
    type: "Defect",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    fields: {
      description: { type: "string", required: true },
      notes: { type: "string" },
      severity: { type: "string" },
      status: { type: "string" },
      asset: { type: "relationship", relationship: "Asset" },
      property: { type: "relationship", relationship: "Property" },
      client: { type: "relationship", relationship: "Client" },
    },
  },
  assettypes: {
    type: "AssetType",
    methods: ["GET", "POST", "OPTIONS"],
    fields: {
      name: { type: "string", required: true },
      description: { type: "string" },
    },
  },
  users: {
    type: "User",
    methods: ["GET", "POST", "OPTIONS"],
    fields: {
      username: { type: "string", required: true },
      email: { type: "string", required: true },
      first_name: { type: "string" },
      last_name: { type: "string" },
      is_active: { type: "boolean" },
    },
  },
};

function endpointIndex(ver: string): Record<string, string> {
  const base = `/api/${ver}`;
  return Object.fromEntries(Object.keys(RESOURCE_OPTIONS).map((resource) => [resource, `${base}/${resource}/`]));
}

export function optionsRoutes({ app }: RouteContext): void {
  app.options("/api/version/", (c) => {
    c.header("Allow", "GET, OPTIONS");
    return c.json({
      name: "version",
      methods: ["GET", "OPTIONS"],
      fields: {
        latest: { type: "string" },
        deprecated: { type: "array" },
        imminent_removal: { type: "array" },
        removed: { type: "array" },
      },
    });
  });

  app.options("/api/:ver/", (c) => {
    c.header("Allow", "GET, OPTIONS");
    const ver = c.req.param("ver");
    return c.json({
      version: ver,
      methods: ["GET", "OPTIONS"],
      endpoints: endpointIndex(ver),
    });
  });

  app.options("/api/:ver/:resource/", (c) => {
    const resource = c.req.param("resource");
    const meta = RESOURCE_OPTIONS[resource];
    if (!meta) return uptickError(c, 404, "Not Found");
    c.header("Allow", meta.methods.join(", "));
    return c.json({
      endpoint: `/api/${c.req.param("ver")}/${resource}/`,
      ...meta,
    });
  });

  app.options("/api/:ver/:resource/:id", (c) => {
    const resource = c.req.param("resource");
    const meta = RESOURCE_OPTIONS[resource];
    if (!meta) return uptickError(c, 404, "Not Found");
    c.header("Allow", meta.methods.filter((method) => method !== "POST").join(", "));
    return c.json({
      endpoint: `/api/${c.req.param("ver")}/${resource}/${c.req.param("id")}`,
      ...meta,
      methods: meta.methods.filter((method) => method !== "POST"),
    });
  });
}
