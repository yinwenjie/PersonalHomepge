"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
import {
  ReadOnlyHomeRenderer,
  ReadOnlyHomeRendererBoundary
} from "@/components/read-only-home-renderer";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import type { HomeSpace } from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import {
  createPublicHomeDocument,
  type PublicHomeDocumentErrorCode,
  type PublicHomeDocumentV1
} from "@/domain/public-home-document";
import {
  buildPublicHomeShareUrl,
  createPublicHomeShareToken
} from "@/domain/public-home-share";
import { useI18n } from "@/hooks/use-i18n";
import {
  PublicHomeShareRepositoryError,
  PublicHomeShareRepository,
  type PublicHomeShareMetadata
} from "@/infrastructure/public-home-share-repository";

interface PublicHomeSharePanelProps {
  accountLoading: boolean;
  currentHomeSpace: HomeSpace | null;
  documentValue: HomeDocumentV2;
  signedIn: boolean;
  storageReady: boolean;
}

export function PublicHomeSharePanel({
  accountLoading,
  currentHomeSpace,
  documentValue,
  signedIn,
  storageReady
}: PublicHomeSharePanelProps) {
  const { format, t } = useI18n();
  const repository = useMemo(() => new PublicHomeShareRepository(), []);
  const projection = useMemo(() => createPublicHomeDocument(documentValue), [documentValue]);
  const eligibility = getShareEligibility({
    accountLoading,
    currentHomeSpace,
    signedIn,
    storageReady
  });
  const eligibleHomeSpaceId = eligibility.ok ? eligibility.homeSpaceId : null;
  const [metadata, setMetadata] = useState<PublicHomeShareMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(() => Boolean(eligibleHomeSpaceId));
  const [pendingAction, setPendingAction] = useState<"publish" | "revoke" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [manualCopyVisible, setManualCopyVisible] = useState(false);
  const [hasSessionShareUrl, setHasSessionShareUrl] = useState(false);
  const sessionShareUrlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!eligibleHomeSpaceId) {
      return () => {
        cancelled = true;
      };
    }

    void repository.getMetadata(eligibleHomeSpaceId).then(
      (value) => {
        if (!cancelled) {
          setMetadata(value);
          setMetadataLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setError(t("settings.publicShare.metadataFailed"));
          setMetadataLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [eligibleHomeSpaceId, repository, t]);

  async function handlePublish() {
    if (!eligibility.ok || !projection.ok || pendingAction) {
      return;
    }

    if (!(await requestConfirm(t("settings.publicShare.publishConfirm")))) {
      return;
    }

    setPendingAction("publish");
    setMessage("");
    setError("");
    setManualCopyVisible(false);

    try {
      const token = createPublicHomeShareToken();
      const nextMetadata = await repository.publish(
        eligibility.homeSpaceId,
        token,
        projection.document
      );
      const shareUrl = buildPublicHomeShareUrl(token, window.location.origin);
      if (!sessionShareUrlInputRef.current) {
        throw new Error("Share link field unavailable");
      }
      sessionShareUrlInputRef.current.value = shareUrl;
      setHasSessionShareUrl(true);
      setMetadata(nextMetadata);
      setMessage(t("settings.publicShare.published"));
    } catch (caught) {
      if (sessionShareUrlInputRef.current) {
        sessionShareUrlInputRef.current.value = "";
      }
      setHasSessionShareUrl(false);
      setError(t(getPublishErrorMessageKey(caught)));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCopy() {
    const shareUrl = sessionShareUrlInputRef.current?.value ?? "";
    if (!shareUrl) {
      return;
    }

    setMessage("");
    setError("");

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(shareUrl);
      setManualCopyVisible(false);
      setMessage(t("settings.publicShare.copied"));
    } catch {
      setManualCopyVisible(true);
      setError(t("settings.publicShare.copyFailed"));
    }
  }

  async function handleRevoke() {
    if (!eligibility.ok || pendingAction || metadata?.status !== "active") {
      return;
    }

    if (!(await requestConfirm(t("settings.publicShare.revokeConfirm")))) {
      return;
    }

    setPendingAction("revoke");
    setMessage("");
    setError("");

    try {
      const nextMetadata = await repository.revoke(eligibility.homeSpaceId);
      if (sessionShareUrlInputRef.current) {
        sessionShareUrlInputRef.current.value = "";
      }
      setHasSessionShareUrl(false);
      setManualCopyVisible(false);
      setMetadata(nextMetadata);
      setMessage(t("settings.publicShare.revoked"));
    } catch {
      setError(t("settings.publicShare.revokeFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  const status = getPanelStatus({
    error,
    message,
    metadata,
    metadataLoading,
    t
  });

  return (
    <section className="public-share-panel" aria-labelledby="publicSharePanelTitle">
      <header className="public-share-panel-head">
        <div>
          <span>{t("settings.publicShare.kicker")}</span>
          <h3 id="publicSharePanelTitle">{t("settings.publicShare.title")}</h3>
        </div>
        {metadata?.status === "active" ? (
          <span className="public-share-status-badge">{t("settings.publicShare.activeBadge")}</span>
        ) : null}
      </header>

      {!eligibility.ok ? (
        <StatusMessage tone="neutral">{t(eligibility.messageKey)}</StatusMessage>
      ) : (
        <div className="public-share-panel-content">
          <StatusMessage
            role={status.tone === "danger" ? "alert" : "status"}
            tone={status.tone}
          >
            {status.text}
          </StatusMessage>

          {metadata?.status === "active" ? (
            <dl className="public-share-metadata">
              <div>
                <dt>{t("settings.publicShare.publishedAt")}</dt>
                <dd>{format.dateTime(metadata.publishedAt)}</dd>
              </div>
              <div>
                <dt>{t("settings.publicShare.updatedAt")}</dt>
                <dd>{format.dateTime(metadata.updatedAt)}</dd>
              </div>
            </dl>
          ) : null}

          {projection.ok ? (
            <PublicSharePreview documentValue={projection.document} />
          ) : (
            <StatusMessage tone="warning">
              {t(getProjectionErrorMessageKey(projection.code))}
            </StatusMessage>
          )}

          <div className="public-share-disclosure">
            <strong>{t("settings.publicShare.includedTitle")}</strong>
            <p>{t("settings.publicShare.includedFields")}</p>
            <p>{t("settings.publicShare.excludedFields")}</p>
            <p>{t("settings.publicShare.snapshotNotice")}</p>
          </div>

          <div className="public-share-link-block" hidden={!hasSessionShareUrl}>
            <label htmlFor="currentSessionShareUrl">{t("settings.publicShare.currentSessionLink")}</label>
            <div className="public-share-link-row">
              <input
                ref={sessionShareUrlInputRef}
                id="currentSessionShareUrl"
                readOnly
                spellCheck={false}
                defaultValue=""
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className="utility-button" type="button" onClick={handleCopy}>
                {t("settings.publicShare.copy")}
              </button>
            </div>
            {manualCopyVisible ? (
              <p className="public-share-manual-copy">{t("settings.publicShare.manualCopy")}</p>
            ) : null}
            <p>{t("settings.publicShare.sessionOnlyNotice")}</p>
          </div>
          {!hasSessionShareUrl && metadata?.status === "active" ? (
            <StatusMessage tone="info">{t("settings.publicShare.linkUnavailableAfterRefresh")}</StatusMessage>
          ) : null}

          <div className="settings-actions public-share-actions">
            <button
              className="utility-button public-share-primary-button"
              type="button"
              disabled={!projection.ok || metadataLoading || Boolean(pendingAction)}
              onClick={handlePublish}
            >
              {pendingAction === "publish"
                ? t("settings.publicShare.publishing")
                : getPublishButtonLabel(metadata, hasSessionShareUrl, t)}
            </button>
            {metadata?.status === "active" ? (
              <button
                className="danger-button"
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={handleRevoke}
              >
                {pendingAction === "revoke"
                  ? t("settings.publicShare.revoking")
                  : t("settings.publicShare.revoke")}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function PublicSharePreview({ documentValue }: { documentValue: PublicHomeDocumentV1 }) {
  const { t } = useI18n();
  const siteCount = documentValue.groups.reduce((total, group) => total + group.sites.length, 0);

  return (
    <section className="public-share-preview" aria-labelledby="publicSharePreviewTitle">
      <header>
        <div>
          <h4 id="publicSharePreviewTitle">{t("settings.publicShare.previewTitle")}</h4>
          <p>{t("settings.publicShare.previewMetrics", {
            groups: documentValue.groups.length,
            sites: siteCount
          })}</p>
        </div>
        <span>{t("settings.publicShare.previewBadge")}</span>
      </header>
      <div className="public-share-preview-frame">
        <ReadOnlyHomeRendererBoundary unavailableLabel={t("settings.publicShare.previewUnavailable")}>
          <ReadOnlyHomeRenderer
            document={documentValue}
            status="ready"
            copy={{
              emptyLabel: t("settings.publicShare.previewEmpty"),
              unavailableLabel: t("settings.publicShare.previewUnavailable")
            }}
          />
        </ReadOnlyHomeRendererBoundary>
      </div>
    </section>
  );
}

type ShareEligibility =
  | { ok: true; homeSpaceId: string }
  | {
      ok: false;
      messageKey:
        | "settings.publicShare.reasonAccountLoading"
        | "settings.publicShare.reasonSignedOut"
        | "settings.publicShare.reasonStorageLoading"
        | "settings.publicShare.reasonNoActiveSpace"
        | "settings.publicShare.reasonAccountManagedOnly";
    };

function getShareEligibility({
  accountLoading,
  currentHomeSpace,
  signedIn,
  storageReady
}: Omit<PublicHomeSharePanelProps, "documentValue">): ShareEligibility {
  if (accountLoading) {
    return { ok: false, messageKey: "settings.publicShare.reasonAccountLoading" };
  }

  if (!signedIn) {
    return { ok: false, messageKey: "settings.publicShare.reasonSignedOut" };
  }

  if (!storageReady) {
    return { ok: false, messageKey: "settings.publicShare.reasonStorageLoading" };
  }

  if (!currentHomeSpace) {
    return { ok: false, messageKey: "settings.publicShare.reasonNoActiveSpace" };
  }

  if (currentHomeSpace.accessMode !== "account-managed") {
    return { ok: false, messageKey: "settings.publicShare.reasonAccountManagedOnly" };
  }

  return { ok: true, homeSpaceId: currentHomeSpace.id };
}

function getPanelStatus({
  error,
  message,
  metadata,
  metadataLoading,
  t
}: {
  error: string;
  message: string;
  metadata: PublicHomeShareMetadata | null;
  metadataLoading: boolean;
  t: ReturnType<typeof useI18n>["t"];
}): { text: string; tone: StatusTone } {
  if (error) {
    return { text: error, tone: "danger" };
  }

  if (message) {
    return { text: message, tone: "success" };
  }

  if (metadataLoading) {
    return { text: t("settings.publicShare.loading"), tone: "neutral" };
  }

  if (metadata?.status === "active") {
    return { text: t("settings.publicShare.activeStatus"), tone: "success" };
  }

  if (metadata?.status === "revoked") {
    return { text: t("settings.publicShare.revokedStatus"), tone: "neutral" };
  }

  return { text: t("settings.publicShare.notPublished"), tone: "neutral" };
}

function getProjectionErrorMessageKey(
  code: PublicHomeDocumentErrorCode
):
  | "settings.publicShare.projectionEmpty"
  | "settings.publicShare.projectionLimit"
  | "settings.publicShare.projectionInvalid" {
  if (code === "empty-content") {
    return "settings.publicShare.projectionEmpty";
  }

  if (code === "group-limit-exceeded"
    || code === "site-limit-exceeded"
    || code === "field-limit-exceeded"
    || code === "payload-too-large") {
    return "settings.publicShare.projectionLimit";
  }

  return "settings.publicShare.projectionInvalid";
}

function getPublishErrorMessageKey(
  caught: unknown
):
  | "settings.publicShare.publishDatabaseOutdated"
  | "settings.publicShare.publishFailed"
  | "settings.publicShare.publishNetworkFailed"
  | "settings.publicShare.publishSessionExpired"
  | "settings.publicShare.publishSpaceUnavailable"
  | "settings.publicShare.projectionInvalid" {
  if (!(caught instanceof PublicHomeShareRepositoryError)) {
    return "settings.publicShare.publishFailed";
  }

  switch (caught.code) {
    case "database-outdated":
      return "settings.publicShare.publishDatabaseOutdated";
    case "session-expired":
      return "settings.publicShare.publishSessionExpired";
    case "space-unavailable":
      return "settings.publicShare.publishSpaceUnavailable";
    case "network-failed":
      return "settings.publicShare.publishNetworkFailed";
    case "invalid-document":
    case "invalid-token":
      return "settings.publicShare.projectionInvalid";
    default:
      return "settings.publicShare.publishFailed";
  }
}

function getPublishButtonLabel(
  metadata: PublicHomeShareMetadata | null,
  hasSessionLink: boolean,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (metadata?.status !== "active") {
    return t("settings.publicShare.publish");
  }

  return hasSessionLink
    ? t("settings.publicShare.updateSnapshot")
    : t("settings.publicShare.republish");
}
