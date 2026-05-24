import type { Collection, Store } from "@emulators/core";
import type {
  UptickAsset,
  UptickAssetType,
  UptickClient,
  UptickDefect,
  UptickProperty,
  UptickUser,
} from "./entities.js";

export interface UptickStore {
  clients: Collection<UptickClient>;
  properties: Collection<UptickProperty>;
  assets: Collection<UptickAsset>;
  defects: Collection<UptickDefect>;
  assetTypes: Collection<UptickAssetType>;
  users: Collection<UptickUser>;
}

export function getUptickStore(store: Store): UptickStore {
  return {
    clients: store.collection<UptickClient>("uptick.clients", ["contact_email"]),
    properties: store.collection<UptickProperty>("uptick.properties", ["client_id"]),
    assets: store.collection<UptickAsset>("uptick.assets", ["property_id", "client_id"]),
    defects: store.collection<UptickDefect>("uptick.defects", ["asset_id", "property_id", "client_id"]),
    assetTypes: store.collection<UptickAssetType>("uptick.assetTypes"),
    users: store.collection<UptickUser>("uptick.users", ["email"]),
  };
}
