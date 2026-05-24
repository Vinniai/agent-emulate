export interface NangoConnection {
  id: string;
  connection_id: string;
  provider: string;
  provider_config_key: string;
  credentials: {
    type: string;
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    scopes?: string[];
    raw?: Record<string, unknown>;
  };
  connection_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tags?: Record<string, string>;
  created_at: string;
  updated_at: string;
  last_fetched_at?: string;
  errors?: Array<{ type: string; description: string }>;
}

/** Seeded records per connection per model name. */
export type NangoRecordsMap = Record<string, Record<string, unknown>[]>;

export interface NangoConnectionSeed {
  id: string;
  provider: string;
  provider_config_key: string;
  credentials?: {
    access_token?: string;
    refresh_token?: string;
  };
  connection_config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: Record<string, string>;
  records?: NangoRecordsMap;
}
