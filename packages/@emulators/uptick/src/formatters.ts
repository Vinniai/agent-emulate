import type {
  UptickAsset,
  UptickAssetType,
  UptickClient,
  UptickDefect,
  UptickProperty,
  UptickUser,
} from "./entities.js";
import type { UptickStore } from "./store.js";

export interface JsonApiResource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

function toRel(type: string, id: number | null | undefined): unknown {
  if (!id) return { data: null };
  return { data: { type, id: String(id) } };
}

export function formatClient(c: UptickClient): JsonApiResource {
  return {
    type: "Client",
    id: String(c.id),
    attributes: {
      name: c.name,
      // Nango sync reads company_name (falls back to name for individual clients)
      company_name: c.name,
      // Nango sync reads first_name / last_name from contact_name split
      first_name: c.contact_name?.split(" ")[0] || null,
      last_name: c.contact_name?.split(" ").slice(1).join(" ") || null,
      email: c.contact_email || null,
      phone: null,
      is_active: c.is_active,
      // Nango reads archived (inverse of is_active)
      archived: !c.is_active,
      sector: c.sector || null,
      ref: c.ref || null,
      contact_name: c.contact_name || null,
      contact_email: c.contact_email || null,
      // Nango reads created_at / updated_at (not created/updated)
      created_at: c.created_at,
      updated_at: c.updated_at,
    },
  };
}

export function formatProperty(p: UptickProperty, _us: UptickStore): JsonApiResource {
  return {
    type: "Property",
    id: String(p.id),
    attributes: {
      name: p.name,
      is_active: p.is_active,
      // Nango reads archived (inverse of is_active)
      archived: !p.is_active,
      // Nango reads flat address fields (not nested address object)
      address_line_1: p.address_streetline || null,
      suburb: p.address_city || null,
      state: p.address_state || null,
      postcode: p.address_postal_code || null,
      country: p.address_country || "AU",
      // Nango reads client_id in attributes (not relationships)
      client_id: p.client_id ? String(p.client_id) : null,
      // Nango reads created_at / updated_at (not created/updated)
      created_at: p.created_at,
      updated_at: p.updated_at,
    },
    relationships: {
      client: toRel("Client", p.client_id),
    },
  };
}

export function formatAsset(a: UptickAsset, _us: UptickStore): JsonApiResource {
  return {
    type: "Asset",
    id: String(a.id),
    attributes: {
      name: a.name,
      // Nango reads barcode (Uptick's public field name for asset_number)
      barcode: a.asset_number || null,
      asset_number: a.asset_number || null,
      is_active: a.is_active,
      // Nango reads archived (inverse of is_active)
      archived: !a.is_active,
      standard_maintenance: a.standard_maintenance || null,
      // Nango reads asset_type_name in attributes (not from relationship)
      asset_type_name: a.asset_type_name || null,
      // Nango reads property_id / client_id in attributes (not relationships)
      property_id: a.property_id ? String(a.property_id) : null,
      client_id: a.client_id ? String(a.client_id) : null,
      // Nango reads created_at / updated_at (not created/updated)
      created_at: a.created_at,
      updated_at: a.updated_at,
    },
    relationships: {
      property: toRel("Property", a.property_id),
      client: toRel("Client", a.client_id),
      asset_type: toRel("AssetType", a.asset_type_id),
    },
  };
}

export function formatDefect(d: UptickDefect, _us: UptickStore): JsonApiResource {
  return {
    type: "Defect",
    id: String(d.id),
    attributes: {
      description: d.description,
      notes: d.notes || null,
      severity: d.severity || null,
      status: d.status || "open",
      // Nango reads asset_id / property_id / client_id in attributes (not relationships)
      asset_id: d.asset_id ? String(d.asset_id) : null,
      property_id: d.property_id ? String(d.property_id) : null,
      client_id: d.client_id ? String(d.client_id) : null,
      // Nango reads created_at / updated_at (not created/updated)
      created_at: d.created_at,
      updated_at: d.updated_at,
      // Nango reads resolved_at for completed defects
      resolved_at: d.status === "resolved" || d.status === "closed" ? d.updated_at : null,
    },
    relationships: {
      asset: toRel("Asset", d.asset_id),
      property: toRel("Property", d.property_id),
      client: toRel("Client", d.client_id),
    },
  };
}

export function formatAssetType(t: UptickAssetType): JsonApiResource {
  return {
    type: "AssetType",
    id: String(t.id),
    attributes: {
      name: t.name,
      description: t.description || null,
    },
  };
}

export function formatUser(u: UptickUser): JsonApiResource {
  return {
    type: "User",
    id: String(u.id),
    attributes: {
      username: u.username,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      is_active: u.is_active,
    },
  };
}
