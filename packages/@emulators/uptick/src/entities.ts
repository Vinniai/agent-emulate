import type { Entity } from "@emulators/core";

export interface UptickClient extends Entity {
  name: string;
  is_active: boolean;
  sector: string;
  ref: string;
  contact_name: string;
  contact_email: string;
}

export interface UptickProperty extends Entity {
  name: string;
  client_id: number;
  is_active: boolean;
  address_display: string;
  address_streetline: string;
  address_city: string;
  address_state: string;
  address_postal_code: string;
  address_country: string;
}

export interface UptickAsset extends Entity {
  name: string;
  asset_number: string;
  is_active: boolean;
  standard_maintenance: string;
  property_id: number | null;
  client_id: number | null;
  asset_type_id: number | null;
  asset_type_name: string;
}

export interface UptickDefect extends Entity {
  description: string;
  notes: string;
  severity: string;
  status: string;
  asset_id: number | null;
  property_id: number | null;
  client_id: number | null;
}

export interface UptickAssetType extends Entity {
  name: string;
  description: string;
}

export interface UptickUser extends Entity {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
}
