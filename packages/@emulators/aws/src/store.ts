import { Store, type Collection } from "@emulators/core";
import type {
  S3Bucket,
  S3Object,
  S3MultipartUpload,
  S3ObjectTagging,
  SqsQueue,
  SqsMessage,
  IamUser,
  IamRole,
  KmsKey,
  KmsAlias,
  Secret,
  SecretVersion,
  SsmParameter,
  SsmParameterVersion,
} from "./entities.js";

export interface AwsStore {
  s3Buckets: Collection<S3Bucket>;
  s3Objects: Collection<S3Object>;
  s3MultipartUploads: Collection<S3MultipartUpload>;
  s3ObjectTaggings: Collection<S3ObjectTagging>;
  sqsQueues: Collection<SqsQueue>;
  sqsMessages: Collection<SqsMessage>;
  iamUsers: Collection<IamUser>;
  iamRoles: Collection<IamRole>;
  kmsKeys: Collection<KmsKey>;
  kmsAliases: Collection<KmsAlias>;
  secrets: Collection<Secret>;
  secretVersions: Collection<SecretVersion>;
  ssmParameters: Collection<SsmParameter>;
  ssmParameterVersions: Collection<SsmParameterVersion>;
}

export function getAwsStore(store: Store): AwsStore {
  return {
    s3Buckets: store.collection<S3Bucket>("aws.s3_buckets", ["bucket_name"]),
    s3Objects: store.collection<S3Object>("aws.s3_objects", ["key", "bucket_name"]),
    s3MultipartUploads: store.collection<S3MultipartUpload>("aws.s3_multipart_uploads", [
      "upload_id",
      "bucket_name",
      "key",
    ]),
    s3ObjectTaggings: store.collection<S3ObjectTagging>("aws.s3_object_taggings", ["bucket_name", "key"]),
    sqsQueues: store.collection<SqsQueue>("aws.sqs_queues", ["queue_name", "queue_url"]),
    sqsMessages: store.collection<SqsMessage>("aws.sqs_messages", ["message_id", "queue_name"]),
    iamUsers: store.collection<IamUser>("aws.iam_users", ["user_name", "user_id"]),
    iamRoles: store.collection<IamRole>("aws.iam_roles", ["role_name", "role_id"]),
    kmsKeys: store.collection<KmsKey>("aws.kms_keys", ["key_id", "arn"]),
    kmsAliases: store.collection<KmsAlias>("aws.kms_aliases", ["alias_name", "alias_arn"]),
    secrets: store.collection<Secret>("aws.secrets", ["name", "arn"]),
    secretVersions: store.collection<SecretVersion>("aws.secret_versions", ["secret_arn", "version_id"]),
    ssmParameters: store.collection<SsmParameter>("aws.ssm_parameters", ["name", "arn"]),
    ssmParameterVersions: store.collection<SsmParameterVersion>("aws.ssm_parameter_versions", ["name", "version"]),
  };
}
