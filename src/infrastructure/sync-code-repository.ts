import { HomeDocumentV2 } from "@/domain/home-document";
import { StoredSyncBinding } from "@/domain/sync-code";
import { createCloudSnapshotPayload } from "@/infrastructure/cloud-home-snapshot-repository";
import { decryptHomeDocument, encryptHomeDocument, EncryptedHomeDocument } from "@/infrastructure/sync-crypto";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase-client";

interface CreateSyncSpaceRow {
  space_id: string;
  revision: number;
  updated_at: string;
}

interface PullSyncSpaceRow {
  document_ciphertext: string;
  document_iv: string;
  document_salt: string;
  document_schema_version: number;
  revision: number;
  updated_at: string;
}

interface CheckSyncSpaceRevisionRow {
  revision: number;
  updated_at: string;
}

interface PushSyncSpaceRow {
  status: "ok" | "conflict";
  revision: number;
  remote_revision: number;
  updated_at: string;
  snapshot_id?: string | null;
}

interface ForcePushSyncSpaceRow {
  status: "ok";
  revision: number;
  updated_at: string;
  snapshot_id?: string | null;
}

interface RevokeSyncSpaceRow {
  status: "revoked";
}

export interface CreateSyncSpaceResult {
  spaceId: string;
  revision: number;
  updatedAt: string;
}

export interface PullSyncSpaceResult {
  document: HomeDocumentV2;
  revision: number;
  updatedAt: string;
}

export interface CheckSyncSpaceRevisionResult {
  revision: number;
  updatedAt: string;
}

export type PushSyncSpaceResult =
  | { status: "ok"; revision: number; updatedAt: string }
  | { status: "conflict"; remoteRevision: number; updatedAt: string };

export class SyncCodeRepository {
  async create(documentValue: HomeDocumentV2, secrets: Pick<StoredSyncBinding, "accessToken" | "encryptionKey">): Promise<CreateSyncSpaceResult> {
    const encryptedDocument = await encryptHomeDocument(documentValue, secrets.encryptionKey);
    const row = await rpcSingle<CreateSyncSpaceRow>("create_sync_space", {
      p_access_token: secrets.accessToken,
      ...toRpcEncryptedDocument(encryptedDocument)
    });

    return {
      spaceId: row.space_id,
      revision: row.revision,
      updatedAt: row.updated_at
    };
  }

  async pull(binding: Pick<StoredSyncBinding, "spaceId" | "accessToken" | "encryptionKey">): Promise<PullSyncSpaceResult> {
    const row = await rpcSingle<PullSyncSpaceRow>("pull_sync_space", {
      p_space_id: binding.spaceId,
      p_access_token: binding.accessToken
    });
    const documentValue = await decryptHomeDocument(fromPullRow(row), binding.encryptionKey);

    return {
      document: documentValue,
      revision: row.revision,
      updatedAt: row.updated_at
    };
  }

  async check(binding: Pick<StoredSyncBinding, "spaceId" | "accessToken">): Promise<CheckSyncSpaceRevisionResult> {
    const row = await rpcSingle<CheckSyncSpaceRevisionRow>("check_sync_space_revision", {
      p_space_id: binding.spaceId,
      p_access_token: binding.accessToken
    });

    return {
      revision: row.revision,
      updatedAt: row.updated_at
    };
  }

  async push(
    binding: Pick<StoredSyncBinding, "accessMode" | "spaceId" | "accessToken" | "encryptionKey" | "remoteRevision">,
    documentValue: HomeDocumentV2
  ): Promise<PushSyncSpaceResult> {
    const encryptedDocument = await encryptHomeDocument(documentValue, binding.encryptionKey);
    const row = await rpcSingle<PushSyncSpaceRow>(binding.accessMode === "account-managed"
      ? "push_account_managed_sync_space"
      : "push_sync_space", {
      p_space_id: binding.spaceId,
      p_access_token: binding.accessToken,
      p_base_revision: binding.remoteRevision,
      ...toRpcEncryptedDocument(encryptedDocument),
      ...(binding.accessMode === "account-managed"
        ? createCloudSnapshotPayload(documentValue, "after-cloud-push")
        : {})
    });

    if (row.status === "conflict") {
      return {
        status: "conflict",
        remoteRevision: row.remote_revision,
        updatedAt: row.updated_at
      };
    }

    return {
      status: "ok",
      revision: row.revision,
      updatedAt: row.updated_at
    };
  }

  async forcePush(
    binding: Pick<StoredSyncBinding, "accessMode" | "spaceId" | "accessToken" | "encryptionKey">,
    documentValue: HomeDocumentV2
  ): Promise<CreateSyncSpaceResult> {
    const encryptedDocument = await encryptHomeDocument(documentValue, binding.encryptionKey);
    const row = await rpcSingle<ForcePushSyncSpaceRow>(binding.accessMode === "account-managed"
      ? "force_push_account_managed_sync_space"
      : "force_push_sync_space", {
      p_space_id: binding.spaceId,
      p_access_token: binding.accessToken,
      ...toRpcEncryptedDocument(encryptedDocument),
      ...(binding.accessMode === "account-managed"
        ? createCloudSnapshotPayload(documentValue, "after-cloud-force-push")
        : {})
    });

    return {
      spaceId: binding.spaceId,
      revision: row.revision,
      updatedAt: row.updated_at
    };
  }

  async revoke(binding: Pick<StoredSyncBinding, "spaceId" | "accessToken">): Promise<void> {
    const row = await rpcSingle<RevokeSyncSpaceRow>("revoke_sync_space", {
      p_space_id: binding.spaceId,
      p_access_token: binding.accessToken
    });

    if (row.status !== "revoked") {
      throw new Error("同步码废弃失败");
    }
  }
}

async function rpcSingle<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(functionName, args);

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`Unexpected RPC response from ${functionName}`);
  }

  return data[0] as T;
}

function toRpcEncryptedDocument(encryptedDocument: EncryptedHomeDocument) {
  return {
    p_document_ciphertext: encryptedDocument.documentCiphertext,
    p_document_iv: encryptedDocument.documentIv,
    p_document_salt: encryptedDocument.documentSalt,
    p_document_schema_version: encryptedDocument.documentSchemaVersion
  };
}

function fromPullRow(row: PullSyncSpaceRow): EncryptedHomeDocument {
  return {
    documentCiphertext: row.document_ciphertext,
    documentIv: row.document_iv,
    documentSalt: row.document_salt,
    documentSchemaVersion: row.document_schema_version
  };
}
