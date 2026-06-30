import type { HomeSpace } from "@/domain/account";
import {
  createId,
  type HomeDocumentV2,
  normalizeHomeDocument
} from "@/domain/home-document";
import {
  createDocumentProtectionState,
  type HomeDocumentClass
} from "@/domain/home-document-protection";
import {
  loadOrTouchLocalDevice,
  type LocalDeviceRecord
} from "@/infrastructure/local-device-repository";
import {
  summarizeHomeDocument,
  type LocalHomeSnapshotSummary
} from "@/infrastructure/local-home-snapshot-repository";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase-client";

export const CLOUD_HOME_SNAPSHOT_LIMIT = 50;

export type CloudHomeSnapshotSource =
  | "account-managed-created"
  | "cloud-baseline"
  | "after-cloud-push"
  | "after-cloud-force-push";

export type CloudHomeSnapshotSummary = LocalHomeSnapshotSummary;

export interface CloudHomeSnapshot {
  id: string;
  contentFingerprint: string;
  createdAt: string;
  document: HomeDocumentV2;
  documentClass: Extract<HomeDocumentClass, "user-data">;
  documentId: string;
  homeSpaceId: string;
  revision: number;
  source: CloudHomeSnapshotSource;
  summary: CloudHomeSnapshotSummary;
  syncSpaceId: string;
  userId: string;
}

interface CloudHomeSnapshotRow {
  id: string;
  user_id: string;
  home_space_id: string;
  sync_space_id: string;
  revision: number;
  snapshot_source: CloudHomeSnapshotSource;
  document_class: HomeDocumentClass;
  content_fingerprint: string;
  document_json: unknown;
  summary: unknown;
  created_at: string;
}

export interface CloudSnapshotRpcPayload {
  p_client_device_id: string | null;
  p_content_fingerprint: string;
  p_document_class: HomeDocumentClass;
  p_document_json: HomeDocumentV2 | null;
  p_operation_id: string;
  p_snapshot_source: CloudHomeSnapshotSource;
  p_summary: CloudHomeSnapshotSummary;
}

interface CloudSnapshotInsertResult {
  status: "saved" | "skipped";
  snapshot: CloudHomeSnapshot | null;
}

export class CloudHomeSnapshotRepository {
  async listSnapshots(homeSpaceId: string): Promise<CloudHomeSnapshot[]> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("home_space_snapshots")
      .select("id, user_id, home_space_id, sync_space_id, revision, snapshot_source, document_class, content_fingerprint, document_json, summary, created_at")
      .eq("home_space_id", homeSpaceId)
      .order("created_at", { ascending: false })
      .limit(CLOUD_HOME_SNAPSHOT_LIMIT);

    if (error) {
      throw error;
    }

    return ((data ?? []) as CloudHomeSnapshotRow[])
      .map(mapCloudHomeSnapshot)
      .filter((snapshot): snapshot is CloudHomeSnapshot => Boolean(snapshot));
  }

  async createBaselineIfMissing(
    homeSpace: HomeSpace,
    documentValue: HomeDocumentV2,
    revision: number
  ): Promise<CloudSnapshotInsertResult> {
    if (homeSpace.accessMode !== "account-managed") {
      return { status: "skipped", snapshot: null };
    }

    const existingSnapshots = await this.listSnapshots(homeSpace.id);
    if (existingSnapshots.length > 0) {
      return { status: "skipped", snapshot: null };
    }

    const payload = createCloudSnapshotPayload(documentValue, "cloud-baseline");
    if (payload.p_document_class !== "user-data" || !payload.p_document_json) {
      return { status: "skipped", snapshot: null };
    }

    const { data, error } = await getSupabaseBrowserClient()
      .from("home_space_snapshots")
      .insert({
        user_id: homeSpace.userId,
        home_space_id: homeSpace.id,
        sync_space_id: homeSpace.syncSpaceId,
        revision,
        snapshot_source: "cloud-baseline",
        document_class: "user-data",
        content_fingerprint: payload.p_content_fingerprint,
        document_json: payload.p_document_json,
        summary: payload.p_summary,
        actor_user_id: homeSpace.userId,
        client_device_id: payload.p_client_device_id,
        operation_id: payload.p_operation_id
      })
      .select("id, user_id, home_space_id, sync_space_id, revision, snapshot_source, document_class, content_fingerprint, document_json, summary, created_at")
      .single();

    if (error) {
      throw error;
    }

    await this.recordAuditEvent({
      eventType: "cloud_snapshot.baseline_created",
      homeSpaceId: homeSpace.id,
      syncSpaceId: homeSpace.syncSpaceId,
      userId: homeSpace.userId,
      afterRevision: revision,
      snapshotId: data.id,
      documentClassAfter: "user-data",
      summaryAfter: payload.p_summary,
      metadata: {
        source: "cloud-baseline"
      }
    });

    return {
      status: "saved",
      snapshot: mapCloudHomeSnapshot(data as CloudHomeSnapshotRow)
    };
  }

  async recordRestoredToLocal(snapshot: CloudHomeSnapshot): Promise<void> {
    await this.recordAuditEvent({
      eventType: "cloud_snapshot.restored_to_local",
      severity: "warning",
      homeSpaceId: snapshot.homeSpaceId,
      syncSpaceId: snapshot.syncSpaceId,
      userId: snapshot.userId,
      beforeRevision: snapshot.revision,
      snapshotId: snapshot.id,
      documentClassBefore: snapshot.documentClass,
      summaryBefore: snapshot.summary,
      metadata: {
        source: snapshot.source
      }
    });
  }

  private async recordAuditEvent(input: {
    eventType: string;
    severity?: "info" | "warning" | "danger";
    homeSpaceId: string;
    syncSpaceId: string;
    userId: string;
    beforeRevision?: number | null;
    afterRevision?: number | null;
    snapshotId?: string | null;
    documentClassBefore?: HomeDocumentClass | null;
    documentClassAfter?: HomeDocumentClass | null;
    summaryBefore?: CloudHomeSnapshotSummary | null;
    summaryAfter?: CloudHomeSnapshotSummary | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const device = loadOrTouchLocalDevice();
    const { error } = await getSupabaseBrowserClient()
      .from("home_space_audit_events")
      .insert({
        user_id: input.userId,
        home_space_id: input.homeSpaceId,
        sync_space_id: input.syncSpaceId,
        event_type: input.eventType,
        severity: input.severity ?? "info",
        before_revision: input.beforeRevision ?? null,
        after_revision: input.afterRevision ?? null,
        snapshot_id: input.snapshotId ?? null,
        document_class_before: input.documentClassBefore ?? null,
        document_class_after: input.documentClassAfter ?? null,
        summary_before: input.summaryBefore ?? null,
        summary_after: input.summaryAfter ?? null,
        actor_user_id: input.userId,
        client_device_id: device?.id ?? null,
        metadata: input.metadata ?? {}
      });

    if (error) {
      throw error;
    }
  }
}

export function createCloudSnapshotPayload(
  documentValue: HomeDocumentV2,
  source: CloudHomeSnapshotSource,
  device: LocalDeviceRecord | null = loadOrTouchLocalDevice()
): CloudSnapshotRpcPayload {
  const normalized = normalizeHomeDocument(documentValue);
  const protection = createDocumentProtectionState(normalized);

  return {
    p_client_device_id: device?.id ?? null,
    p_content_fingerprint: protection.contentFingerprint,
    p_document_class: protection.documentClass,
    p_document_json: protection.isUserData ? normalized : null,
    p_operation_id: createId("operation"),
    p_snapshot_source: source,
    p_summary: summarizeHomeDocument(normalized)
  };
}

function mapCloudHomeSnapshot(row: CloudHomeSnapshotRow): CloudHomeSnapshot | null {
  try {
    if (row.document_class !== "user-data") {
      return null;
    }

    const documentValue = normalizeHomeDocument(row.document_json);
    const summary = isCloudSnapshotSummary(row.summary)
      ? row.summary
      : summarizeHomeDocument(documentValue);

    return {
      id: row.id,
      contentFingerprint: row.content_fingerprint,
      createdAt: row.created_at,
      document: documentValue,
      documentClass: "user-data",
      documentId: documentValue.documentId,
      homeSpaceId: row.home_space_id,
      revision: row.revision,
      source: row.snapshot_source,
      summary,
      syncSpaceId: row.sync_space_id,
      userId: row.user_id
    };
  } catch {
    return null;
  }
}

function isCloudSnapshotSummary(value: unknown): value is CloudHomeSnapshotSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const summary = value as Record<string, unknown>;
  return typeof summary.documentTitle === "string"
    && typeof summary.groupCount === "number"
    && typeof summary.siteCount === "number"
    && typeof summary.widgetCount === "number"
    && typeof summary.themePresetId === "string"
    && typeof summary.hasBanner === "boolean"
    && typeof summary.hasBackground === "boolean"
    && typeof summary.updatedAt === "string"
    && typeof summary.syncStatus === "string";
}
