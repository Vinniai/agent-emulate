import type { Entity } from "@emulators/core";

export interface S3Bucket extends Entity {
  bucket_name: string;
  region: string;
  creation_date: string;
  acl: "private" | "public-read" | "public-read-write";
  versioning_enabled: boolean;
}

export interface S3Object extends Entity {
  bucket_name: string;
  key: string;
  body: string;
  content_type: string;
  content_length: number;
  etag: string;
  last_modified: string;
  metadata: Record<string, string>;
  version_id?: string;
}

export interface S3MultipartUpload extends Entity {
  upload_id: string;
  bucket_name: string;
  key: string;
  content_type: string;
  parts: Array<{ part_number: number; etag: string; body: string }>;
}

export interface S3ObjectTagging extends Entity {
  bucket_name: string;
  key: string;
  tags: Array<{ key: string; value: string }>;
}

export interface SqsQueue extends Entity {
  queue_name: string;
  queue_url: string;
  arn: string;
  visibility_timeout: number;
  delay_seconds: number;
  max_message_size: number;
  message_retention_period: number;
  receive_message_wait_time: number;
  fifo: boolean;
}

export interface SqsMessage extends Entity {
  queue_name: string;
  message_id: string;
  receipt_handle: string;
  body: string;
  md5_of_body: string;
  attributes: Record<string, string>;
  message_attributes: Record<string, { DataType: string; StringValue?: string; BinaryValue?: string }>;
  visible_after: number;
  sent_timestamp: number;
  receive_count: number;
}

export interface IamUser extends Entity {
  user_name: string;
  user_id: string;
  arn: string;
  path: string;
  access_keys: Array<{ access_key_id: string; secret_access_key: string; status: "Active" | "Inactive" }>;
}

export interface IamRole extends Entity {
  role_name: string;
  role_id: string;
  arn: string;
  path: string;
  assume_role_policy_document: string;
  description: string;
}

// --- KMS (JSON 1.1 protocol) ---

export interface KmsKey extends Entity {
  account_id: string;
  region: string;
  key_id: string;
  arn: string;
  creation_date: number;
  enabled: boolean;
  key_usage: string;
  key_state: string;
  origin: string;
  key_manager: string;
  customer_master_key_spec: string;
  key_spec: string;
  multi_region: boolean;
  description: string;
  deletion_date?: number;
}

export interface KmsAlias extends Entity {
  account_id: string;
  region: string;
  alias_name: string;
  alias_arn: string;
  target_key_id: string;
  creation_date: number;
}

// --- Secrets Manager (JSON 1.1 protocol) ---

export interface Secret extends Entity {
  account_id: string;
  region: string;
  arn: string;
  name: string;
  description: string;
  kms_key_id: string;
  tags: Array<{ Key: string; Value: string }>;
  created_date: number;
  last_changed_date: number;
  deleted_date?: number;
}

export interface SecretVersion extends Entity {
  secret_arn: string;
  version_id: string;
  secret_string?: string;
  secret_binary?: string;
  version_stages: string[];
  created_date: number;
}

// --- SSM Parameter Store (JSON 1.1 protocol) ---

export interface SsmParameter extends Entity {
  account_id: string;
  region: string;
  name: string;
  type: "String" | "StringList" | "SecureString";
  value: string;
  version: number;
  tier: string;
  data_type: string;
  key_id: string;
  description: string;
  arn: string;
  last_modified_date: number;
  tags: Array<{ Key: string; Value: string }>;
}

export interface SsmParameterVersion extends Entity {
  name: string;
  version: number;
  value: string;
  type: string;
  labels: string[];
  created_date: number;
}
