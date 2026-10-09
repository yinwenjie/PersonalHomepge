"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { requestConfirm, showAlert } from "@/components/confirm-dialog";
import { StatusMessage } from "@/components/status-message";
import type { HomeSpace } from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import {
  HOME_TEMPLATES,
  createHomeDocumentFromTemplate,
  summarizeHomeTemplate,
  type HomeTemplate,
  type HomeTemplateId
} from "@/domain/home-template";
import { parseSyncCode, type StoredSyncBinding } from "@/domain/sync-code";
import type { AccountDataState } from "@/hooks/use-account-data";
import { useI18n } from "@/hooks/use-i18n";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import { formatHomeTemplateName } from "@/i18n/home-presentation";
import { formatSettingsHomeSpaceAccessMode } from "@/i18n/settings-presentation";

interface HomeSpacesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
  embedded?: boolean;
  currentBinding: StoredSyncBinding | null;
  documentValue: HomeDocumentV2;
  storageReady: boolean;
  onActivateHomeSpace: (homeSpace: HomeSpace, syncCode: string) => Promise<boolean>;
  onBeforeOverwrite: (source: LocalHomeSnapshotSource) => boolean;
  onRestoreManagedHomeSpace: (homeSpace: HomeSpace) => Promise<boolean>;
  onMigrateSyncCodeHomeSpace: (homeSpace: HomeSpace) => Promise<boolean>;
  onManagedHomeSpaceCreated: (binding: StoredSyncBinding, documentValue?: HomeDocumentV2) => void;
}

type CreateSpaceDialog = "current" | "template-select" | "template-name" | null;

const DEFAULT_TEMPLATE_ID = HOME_TEMPLATES.find((template) => template.id === "minimal")?.id ?? HOME_TEMPLATES[0].id;

export function HomeSpacesPanel({
  accountData,
  authLoading,
  signedIn,
  embedded = false,
  currentBinding,
  documentValue,
  storageReady,
  onActivateHomeSpace,
  onBeforeOverwrite,
  onRestoreManagedHomeSpace,
  onMigrateSyncCodeHomeSpace,
  onManagedHomeSpaceCreated
}: HomeSpacesPanelProps) {
  const { format, t } = useI18n();
  const [claimSpaceName, setClaimSpaceName] = useState(() => t("settings.homeSpaces.defaultName"));
  const [createDialog, setCreateDialog] = useState<CreateSpaceDialog>(null);
  const [currentCreateName, setCurrentCreateName] = useState(() => t("settings.homeSpaces.defaultName"));
  const [selectedTemplateId, setSelectedTemplateId] = useState<HomeTemplateId>(DEFAULT_TEMPLATE_ID);
  const [templateSpaceName, setTemplateSpaceName] = useState("");
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState("");
  const [activationError, setActivationError] = useState("");
  const [activationPending, setActivationPending] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<HomeTemplateId | null>(null);
  const [managedRestoreSpaceId, setManagedRestoreSpaceId] = useState<string | null>(null);
  const [managedMigrationSpaceId, setManagedMigrationSpaceId] = useState<string | null>(null);
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editingSpaceName, setEditingSpaceName] = useState("");
  const [defaultPendingSpaceId, setDefaultPendingSpaceId] = useState<string | null>(null);
  const [removingSpaceId, setRemovingSpaceId] = useState<string | null>(null);
  const accountReady = Boolean(accountData.profile && accountData.preferences && !accountData.loading);
  const accountActionPending = accountData.claiming
    || accountData.activating
    || accountData.creatingManaged
    || accountData.restoringManaged
    || accountData.migratingManaged
    || accountData.renamingHomeSpace
    || accountData.settingDefaultHomeSpace
    || accountData.removingHomeSpace;
  const currentHomeSpace = useMemo(() => {
    if (!currentBinding) {
      return null;
    }

    return accountData.homeSpaces.find((homeSpace) => homeSpace.syncSpaceId === currentBinding.spaceId) ?? null;
  }, [accountData.homeSpaces, currentBinding]);
  const migrationBlockReason = getMigrationBlockReason(documentValue.syncMeta.status, t);
  const canMigrateCurrentHomeSpace = Boolean(
    currentHomeSpace
      && currentBinding?.accessMode === "sync-code"
      && currentHomeSpace.accessMode === "sync-code"
  );
  const createManagedDisabledReason = getCreateManagedDisabledReason(storageReady, accountReady, accountActionPending, t);
  const claimDisabledReason = accountActionPending ? t("settings.homeSpaces.actionPending") : undefined;
  const panelHasError = Boolean(
    accountData.homeSpaceError
      || accountData.claimError
      || accountData.activationError
      || accountData.managedCreateError
      || accountData.managedRestoreError
      || accountData.managedMigrationError
  );
  const panelMessage = accountData.homeSpaceError
    || accountData.managedCreateError
    || accountData.managedRestoreError
    || accountData.managedMigrationError
    || accountData.claimError
    || accountData.activationError
    || accountData.homeSpaceMessage
    || accountData.managedMigrationMessage
    || accountData.managedRestoreMessage
    || accountData.managedCreateMessage
    || accountData.claimMessage
    || accountData.activationMessage
    || t("settings.homeSpaces.panelDefault");
  const panelStatusTone = panelHasError
    ? "danger"
    : accountData.homeSpaceMessage
      || accountData.managedMigrationMessage
      || accountData.managedRestoreMessage
      || accountData.managedCreateMessage
      || accountData.claimMessage
      || accountData.activationMessage
      ? "success"
      : "neutral";
  const selectedTemplate = HOME_TEMPLATES.find((template) => template.id === selectedTemplateId) ?? HOME_TEMPLATES[0];

  async function handleClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await accountData.claimHomeSpace(currentBinding?.spaceId ?? "", claimSpaceName);
    trackProductEvent("home_space.claimed", {
      accessMode: currentBinding?.accessMode ?? "sync-code"
    });
  }

  async function handleCreateManaged(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady || !accountReady || accountActionPending) {
      return;
    }

    const binding = await accountData.createAccountManagedHomeSpace(currentCreateName.trim() || t("settings.homeSpaces.defaultName"), documentValue);
    if (binding) {
      onManagedHomeSpaceCreated(binding, documentValue);
      trackProductEvent("home_space.account_managed_created", {
        source: "current"
      });
      setCreateDialog(null);
      setCurrentCreateName(t("settings.homeSpaces.defaultName"));
    }
  }

  async function handleCreateManagedFromTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!storageReady || !accountReady || accountActionPending) {
      return;
    }

    const templateDocument = createHomeDocumentFromTemplate(selectedTemplate.id);
    const spaceName = templateSpaceName.trim() || selectedTemplate.recommendedSpaceName;
    if (!onBeforeOverwrite("before-template-home-space-switch")) {
      void showAlert(t("settings.homeSpaces.createTemplateProtectFailed"));
      return;
    }

    setCreatingTemplateId(selectedTemplate.id);
    try {
      const binding = await accountData.createAccountManagedHomeSpace(spaceName, templateDocument);
      if (binding) {
        onManagedHomeSpaceCreated(binding, templateDocument);
        trackProductEvent("home_space.account_managed_template_created", {
          source: "template",
          templateId: selectedTemplate.id
        });
        setCreateDialog(null);
        setTemplateSpaceName("");
      }
    } finally {
      setCreatingTemplateId(null);
    }
  }

  function handleTemplateSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTemplateSpaceName(selectedTemplate.recommendedSpaceName);
    setCreateDialog("template-name");
  }

  async function handleActivate(event: FormEvent<HTMLFormElement>, homeSpace: HomeSpace) {
    event.preventDefault();
    const normalizedCode = activationCode.trim();
    setActivationError("");

    try {
      const parsed = parseSyncCode(normalizedCode);
      if (parsed.spaceId !== homeSpace.syncSpaceId) {
        setActivationError(t("settings.homeSpaces.activateWrongSpace"));
        return;
      }
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : t("settings.homeSpaces.activateInvalid"));
      return;
    }

    if (!(await requestConfirm(t("settings.homeSpaces.confirmActivateMessage")))) {
      return;
    }

    if (!onBeforeOverwrite("before-home-space-activate")) {
      setActivationError(t("settings.homeSpaces.activateProtectFailed"));
      return;
    }

    setActivationPending(true);
    try {
      const activated = await onActivateHomeSpace(homeSpace, normalizedCode);
      if (activated) {
        trackProductEvent("home_space.sync_code_activated", {
          accessMode: homeSpace.accessMode
        });
        setActivationCode("");
        setActiveSpaceId(null);
      }
    } catch (error) {
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "home_space.activate",
        properties: {
          accessMode: homeSpace.accessMode,
          source: "home-spaces-panel"
        },
        severity: "error"
      });
      setActivationError(error instanceof Error ? error.message : t("settings.homeSpaces.activateFailed"));
    } finally {
      setActivationPending(false);
    }
  }

  async function handleRestoreManaged(homeSpace: HomeSpace) {
    setActivationError("");
    setActivationCode("");
    setActiveSpaceId(null);

    if (!(await requestConfirm(t("settings.homeSpaces.confirmRestoreManaged")))) {
      return;
    }

    if (!onBeforeOverwrite("before-managed-home-space-restore")) {
      setActivationError(t("settings.homeSpaces.restoreProtectFailed"));
      return;
    }

    setManagedRestoreSpaceId(homeSpace.id);
    try {
      const restored = await onRestoreManagedHomeSpace(homeSpace);
      if (restored) {
        trackProductEvent("home_space.account_managed_restored", {
          accessMode: homeSpace.accessMode
        });
      }
    } catch (error) {
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "home_space.managed_restore",
        properties: {
          accessMode: homeSpace.accessMode,
          source: "home-spaces-panel"
        },
        severity: "error"
      });
      setActivationError(error instanceof Error ? error.message : t("settings.homeSpaces.restoreFailed"));
    } finally {
      setManagedRestoreSpaceId(null);
    }
  }

  async function handleMigrateSyncCode(homeSpace: HomeSpace) {
    setActivationError("");
    setActivationCode("");
    setActiveSpaceId(null);

    if (migrationBlockReason) {
      return;
    }

    if (!(await requestConfirm(t("settings.homeSpaces.confirmMigrate")))) {
      return;
    }

    setManagedMigrationSpaceId(homeSpace.id);
    try {
      const migrated = await onMigrateSyncCodeHomeSpace(homeSpace);
      if (migrated) {
        trackProductEvent("home_space.sync_code_migrated", {
          accessMode: "account-managed"
        });
      }
    } catch (error) {
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "home_space.managed_migrate",
        properties: {
          accessMode: homeSpace.accessMode,
          source: "home-spaces-panel"
        },
        severity: "error"
      });
      setActivationError(error instanceof Error ? error.message : t("settings.homeSpaces.migrateFailed"));
    } finally {
      setManagedMigrationSpaceId(null);
    }
  }

  function startRename(homeSpace: HomeSpace) {
    setActivationError("");
    setActivationCode("");
    setActiveSpaceId(null);
    setEditingSpaceId(homeSpace.id);
    setEditingSpaceName(homeSpace.name);
  }

  async function handleRename(event: FormEvent<HTMLFormElement>, homeSpace: HomeSpace) {
    event.preventDefault();
    const renamed = await accountData.renameHomeSpace(homeSpace.id, editingSpaceName);
    if (renamed) {
      setEditingSpaceId(null);
      setEditingSpaceName("");
    }
  }

  async function handleSetDefault(homeSpace: HomeSpace) {
    if (homeSpace.isDefault) {
      return;
    }

    setActivationError("");
    setActivationCode("");
    setActiveSpaceId(null);
    setDefaultPendingSpaceId(homeSpace.id);
    try {
      await accountData.setDefaultHomeSpace(homeSpace.id);
    } finally {
      setDefaultPendingSpaceId(null);
    }
  }

  async function handleRemove(homeSpace: HomeSpace) {
    const isCurrent = currentBinding?.spaceId === homeSpace.syncSpaceId;
    if (isCurrent && homeSpace.accessMode === "account-managed") {
      return;
    }

    if (!(await requestConfirm({ message: removeConfirmMessage(homeSpace, isCurrent, t), tone: "danger" }))) {
      return;
    }

    setActivationError("");
    setActivationCode("");
    setActiveSpaceId(null);
    setRemovingSpaceId(homeSpace.id);
    try {
      const removed = await accountData.removeHomeSpaceFromAccount(homeSpace.id);
      if (removed && editingSpaceId === homeSpace.id) {
        setEditingSpaceId(null);
        setEditingSpaceName("");
      }
      if (removed) {
        trackProductEvent("home_space.removed", {
          accessMode: homeSpace.accessMode
        });
      }
    } finally {
      setRemovingSpaceId(null);
    }
  }

  const content = (
    <>
      {authLoading ? (
        <div className="settings-placeholder">
          <strong>{t("settings.homeSpaces.loadingTitle")}</strong>
          <p>{t("settings.homeSpaces.loadingDescription")}</p>
        </div>
      ) : !signedIn ? (
        <div className="settings-placeholder">
          <strong>{t("settings.homeSpaces.signedOutTitle")}</strong>
          <p>{t("settings.homeSpaces.signedOutDescription")}</p>
        </div>
      ) : accountData.error ? (
        <div className="settings-placeholder">
          <strong>{t("settings.homeSpaces.unavailableTitle")}</strong>
          <StatusMessage role="alert" tone="danger">{accountData.error}</StatusMessage>
        </div>
      ) : (
        <>
          <div className="home-space-create-actions">
            <button
              className="utility-button"
              type="button"
              disabled={Boolean(createManagedDisabledReason)}
              title={createManagedDisabledReason ?? t("settings.homeSpaces.createCurrentTitle")}
              onClick={() => {
                setCurrentCreateName(t("settings.homeSpaces.defaultName"));
                setCreateDialog("current");
              }}
            >
              {t("settings.homeSpaces.createCurrent")}
            </button>
            <button
              className="utility-button"
              type="button"
              disabled={Boolean(createManagedDisabledReason)}
              title={createManagedDisabledReason ?? t("settings.homeSpaces.createTemplateTitle")}
              onClick={() => {
                setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
                setTemplateSpaceName("");
                setCreateDialog("template-select");
              }}
            >
              {t("settings.homeSpaces.createTemplate")}
            </button>
          </div>

          {!currentBinding ? (
            <div className="settings-placeholder">
              <strong>{t("settings.homeSpaces.noBindingTitle")}</strong>
              <p>{t("settings.homeSpaces.noBindingDescription")}</p>
            </div>
          ) : currentHomeSpace ? (
            <div className="settings-placeholder">
              <strong>{t("settings.homeSpaces.currentInAccountTitle")}</strong>
              <p>{t("settings.homeSpaces.currentInAccountDescription", { space: currentHomeSpace.name })}</p>
              {canMigrateCurrentHomeSpace ? (
                <>
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || !accountReady || accountActionPending || Boolean(migrationBlockReason)}
                    title={migrationBlockReason || createManagedDisabledReason || t("settings.homeSpaces.migrateTitle")}
                    onClick={() => handleMigrateSyncCode(currentHomeSpace)}
                  >
                    {accountData.migratingManaged && managedMigrationSpaceId === currentHomeSpace.id ? t("settings.homeSpaces.migrating") : t("settings.homeSpaces.migrate")}
                  </button>
                  {migrationBlockReason ? <StatusMessage role="alert" tone="warning">{migrationBlockReason}</StatusMessage> : null}
                </>
              ) : null}
            </div>
          ) : (
            <form className="home-space-claim-form" onSubmit={handleClaim}>
              <label className="field">
                <span>{t("settings.homeSpaces.nameLabel")}</span>
                <input
                  type="text"
                  value={claimSpaceName}
                  maxLength={80}
                  disabled={accountActionPending}
                  title={claimDisabledReason}
                  onChange={(event) => setClaimSpaceName(event.target.value)}
                />
              </label>
              <button className="utility-button" type="submit" disabled={accountActionPending} title={claimDisabledReason ?? t("settings.homeSpaces.claimTitle")}>
                {accountData.claiming ? t("settings.homeSpaces.claiming") : t("settings.homeSpaces.claim")}
              </button>
            </form>
          )}

          <HomeSpaceList
            accountData={accountData}
            activationCode={activationCode}
            activationError={activationError}
            activeSpaceId={activeSpaceId}
            activationPending={activationPending}
            currentSpaceId={currentBinding?.spaceId ?? null}
            defaultPendingSpaceId={defaultPendingSpaceId}
            editingSpaceId={editingSpaceId}
            editingSpaceName={editingSpaceName}
            managedRestoreSpaceId={managedRestoreSpaceId}
            removingSpaceId={removingSpaceId}
            storageReady={storageReady}
            onActivate={handleActivate}
            onCancelRename={() => {
              setEditingSpaceId(null);
              setEditingSpaceName("");
            }}
            onChangeActivationCode={setActivationCode}
            onChangeEditingName={setEditingSpaceName}
            onRemove={handleRemove}
            onRename={handleRename}
            onRestoreManaged={handleRestoreManaged}
            onSelectSpace={(spaceId) => {
              setActivationError("");
              setActivationCode("");
              setEditingSpaceId(null);
              setEditingSpaceName("");
              setActiveSpaceId((current) => current === spaceId ? null : spaceId);
            }}
            onSetDefault={handleSetDefault}
            onStartRename={startRename}
            t={t}
          />

          <StatusMessage role={panelHasError ? "alert" : "status"} tone={panelStatusTone}>
            {panelMessage}
          </StatusMessage>

          {createDialog === "current" ? (
            <CurrentHomeSpaceCreateDialog
              actionPending={accountData.creatingManaged}
              disabledReason={createManagedDisabledReason}
              name={currentCreateName}
              onCancel={() => setCreateDialog(null)}
              onChangeName={setCurrentCreateName}
              onSubmit={handleCreateManaged}
              onUseDefaultName={() => setCurrentCreateName(t("settings.homeSpaces.defaultName"))}
              t={t}
            />
          ) : null}

          {createDialog === "template-select" ? (
            <TemplateHomeSpaceSelectDialog
              actionPending={accountActionPending}
              disabledReason={createManagedDisabledReason}
              selectedTemplate={selectedTemplate}
              selectedTemplateId={selectedTemplateId}
              onCancel={() => setCreateDialog(null)}
              onSelectTemplate={setSelectedTemplateId}
              onSubmit={handleTemplateSelected}
              formatNumber={format.number}
              t={t}
            />
          ) : null}

          {createDialog === "template-name" ? (
            <TemplateHomeSpaceNameDialog
              actionPending={accountData.creatingManaged}
              creatingTemplateId={creatingTemplateId}
              disabledReason={createManagedDisabledReason}
              name={templateSpaceName}
              selectedTemplate={selectedTemplate}
              selectedTemplateId={selectedTemplateId}
              onCancel={() => setCreateDialog(null)}
              onChangeName={setTemplateSpaceName}
              onSubmit={handleCreateManagedFromTemplate}
              t={t}
            />
          ) : null}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="home-spaces-panel-content">{content}</div>;
  }

  return (
    <section className="settings-panel" aria-label={t("settings.homeSpaces.panelAria")}>
      <div className="panel-header">
        <h2>{t("settings.section.homeSpaces.title")}</h2>
        <span>{signedIn ? t("settings.section.homeSpaces.count", { count: accountData.homeSpaces.length }) : t("settings.section.homeSpaces.signIn")}</span>
      </div>
      {content}
    </section>
  );
}

function CurrentHomeSpaceCreateDialog({
  actionPending,
  disabledReason,
  name,
  t,
  onCancel,
  onChangeName,
  onSubmit,
  onUseDefaultName
}: {
  actionPending: boolean;
  disabledReason?: string;
  name: string;
  t: ReturnType<typeof useI18n>["t"];
  onCancel: () => void;
  onChangeName: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUseDefaultName: () => void;
}) {
  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="currentHomeSpaceCreateTitle">
      <form className="settings-dialog home-space-create-dialog" onSubmit={onSubmit}>
        <div className="settings-dialog-header">
          <div>
            <h2 id="currentHomeSpaceCreateTitle">{t("settings.homeSpaces.createCurrentDialogTitle")}</h2>
            <p>{t("settings.homeSpaces.createCurrentDialogDescription")}</p>
          </div>
          <button className="mini-button" type="button" onClick={onCancel} aria-label={t("settings.common.close")}>×</button>
        </div>
        <div className="settings-dialog-body">
          <label className="field">
            <span>{t("settings.homeSpaces.nameLabel")}</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              disabled={actionPending}
              placeholder={t("settings.homeSpaces.defaultName")}
              onChange={(event) => onChangeName(event.target.value)}
            />
          </label>
          <button className="utility-button" type="button" disabled={actionPending} onClick={onUseDefaultName}>
            {t("settings.homeSpaces.useDefaultName")}
          </button>
          <StatusMessage>
            {t("settings.homeSpaces.createCurrentStatus")}
          </StatusMessage>
        </div>
        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" disabled={actionPending} onClick={onCancel}>{t("settings.common.cancel")}</button>
          <button className="utility-button" type="submit" disabled={actionPending || Boolean(disabledReason)} title={disabledReason ?? t("settings.homeSpaces.confirmCreateTitle")}>
            {actionPending ? t("settings.homeSpaces.creating") : t("settings.homeSpaces.confirmCreate")}
          </button>
        </div>
      </form>
    </div>
  );
}

function TemplateHomeSpaceSelectDialog({
  actionPending,
  disabledReason,
  formatNumber,
  selectedTemplate,
  selectedTemplateId,
  t,
  onCancel,
  onSelectTemplate,
  onSubmit
}: {
  actionPending: boolean;
  disabledReason?: string;
  formatNumber: (value: number) => string;
  selectedTemplate: HomeTemplate;
  selectedTemplateId: HomeTemplateId;
  t: ReturnType<typeof useI18n>["t"];
  onCancel: () => void;
  onSelectTemplate: (templateId: HomeTemplateId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="templateHomeSpaceCreateTitle">
      <form className="settings-dialog settings-dialog-wide home-space-template-dialog" onSubmit={onSubmit}>
        <div className="settings-dialog-header">
          <div>
            <h2 id="templateHomeSpaceCreateTitle">{t("settings.homeSpaces.templateSelectTitle")}</h2>
            <p>{t("settings.homeSpaces.templateSelectDescription")}</p>
          </div>
          <button className="mini-button" type="button" onClick={onCancel} aria-label={t("settings.common.close")}>×</button>
        </div>
        <div className="settings-dialog-body">
          <div className="template-choice-grid" role="radiogroup" aria-label={t("settings.homeSpaces.templateChoiceAria")}>
            {HOME_TEMPLATES.map((template) => {
              const summary = summarizeHomeTemplate(template);
              const selected = selectedTemplateId === template.id;
              const templateName = formatHomeTemplateName(template.id, t);

              return (
                <button
                  className={`template-choice-card${selected ? " is-selected" : ""}`.trim()}
                  key={template.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={actionPending}
                  onClick={() => onSelectTemplate(template.id)}
                >
                  <span className="template-accent" style={{ backgroundColor: template.accent }} aria-hidden="true" />
                  <strong>{templateName}</strong>
                  <span>{t("settings.homeSpaces.templateMetric", {
                    groups: formatNumber(summary.groupCount),
                    sites: formatNumber(summary.siteCount),
                    widgets: formatNumber(summary.widgetCount)
                  })}</span>
                </button>
              );
            })}
          </div>
          <StatusMessage>
            {t("settings.homeSpaces.templateStatus", {
              space: selectedTemplate.recommendedSpaceName,
              template: formatHomeTemplateName(selectedTemplate.id, t)
            })}
          </StatusMessage>
        </div>
        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" disabled={actionPending} onClick={onCancel}>{t("settings.common.cancel")}</button>
          <button className="utility-button" type="submit" disabled={actionPending || Boolean(disabledReason)} title={disabledReason ?? t("settings.homeSpaces.confirmTemplateTitle", { template: formatHomeTemplateName(selectedTemplate.id, t) })}>
            {t("settings.common.confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}

function TemplateHomeSpaceNameDialog({
  actionPending,
  creatingTemplateId,
  disabledReason,
  name,
  selectedTemplate,
  selectedTemplateId,
  t,
  onCancel,
  onChangeName,
  onSubmit
}: {
  actionPending: boolean;
  creatingTemplateId: HomeTemplateId | null;
  disabledReason?: string;
  name: string;
  selectedTemplate: HomeTemplate;
  selectedTemplateId: HomeTemplateId;
  t: ReturnType<typeof useI18n>["t"];
  onCancel: () => void;
  onChangeName: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="templateHomeSpaceNameTitle">
      <form className="settings-dialog home-space-create-dialog" onSubmit={onSubmit}>
        <div className="settings-dialog-header">
          <div>
            <h2 id="templateHomeSpaceNameTitle">{t("settings.homeSpaces.templateNameTitle")}</h2>
            <p>{t("settings.homeSpaces.templateNameDescription", { template: formatHomeTemplateName(selectedTemplate.id, t) })}</p>
          </div>
          <button className="mini-button" type="button" onClick={onCancel} aria-label={t("settings.common.close")}>×</button>
        </div>
        <div className="settings-dialog-body">
          <label className="field">
            <span>{t("settings.homeSpaces.nameLabel")}</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              disabled={actionPending}
              placeholder={selectedTemplate.recommendedSpaceName}
              onChange={(event) => onChangeName(event.target.value)}
            />
          </label>
          <StatusMessage>
            {t("settings.homeSpaces.templateNameStatus")}
          </StatusMessage>
        </div>
        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" disabled={actionPending} onClick={onCancel}>{t("settings.common.cancel")}</button>
          <button className="utility-button" type="submit" disabled={actionPending || Boolean(disabledReason)} title={disabledReason ?? t("settings.homeSpaces.confirmTemplateCreateTitle", { template: formatHomeTemplateName(selectedTemplate.id, t) })}>
            {actionPending && creatingTemplateId === selectedTemplateId ? t("settings.homeSpaces.creating") : t("settings.homeSpaces.confirmCreate")}
          </button>
        </div>
      </form>
    </div>
  );
}

function HomeSpaceList({
  accountData,
  activationCode,
  activationError,
  activationPending,
  activeSpaceId,
  currentSpaceId,
  defaultPendingSpaceId,
  editingSpaceId,
  editingSpaceName,
  managedRestoreSpaceId,
  removingSpaceId,
  storageReady,
  t,
  onActivate,
  onCancelRename,
  onChangeActivationCode,
  onChangeEditingName,
  onRemove,
  onRename,
  onRestoreManaged,
  onSelectSpace,
  onSetDefault,
  onStartRename
}: {
  accountData: AccountDataState;
  activationCode: string;
  activationError: string;
  activationPending: boolean;
  activeSpaceId: string | null;
  currentSpaceId: string | null;
  defaultPendingSpaceId: string | null;
  editingSpaceId: string | null;
  editingSpaceName: string;
  managedRestoreSpaceId: string | null;
  removingSpaceId: string | null;
  storageReady: boolean;
  t: ReturnType<typeof useI18n>["t"];
  onActivate: (event: FormEvent<HTMLFormElement>, homeSpace: HomeSpace) => Promise<void>;
  onCancelRename: () => void;
  onChangeActivationCode: (value: string) => void;
  onChangeEditingName: (value: string) => void;
  onRemove: (homeSpace: HomeSpace) => Promise<void>;
  onRename: (event: FormEvent<HTMLFormElement>, homeSpace: HomeSpace) => Promise<void>;
  onRestoreManaged: (homeSpace: HomeSpace) => Promise<void>;
  onSelectSpace: (spaceId: string) => void;
  onSetDefault: (homeSpace: HomeSpace) => Promise<void>;
  onStartRename: (homeSpace: HomeSpace) => void;
}) {
  if (accountData.loading) {
    return <StatusMessage>{t("settings.homeSpaces.listLoading")}</StatusMessage>;
  }

  if (accountData.homeSpaces.length === 0) {
    return <StatusMessage>{t("settings.homeSpaces.listEmpty")}</StatusMessage>;
  }

  return (
    <div className="home-space-list">
      {accountData.homeSpaces.map((homeSpace) => {
        const isCurrent = homeSpace.syncSpaceId === currentSpaceId;
        const isActive = activeSpaceId === homeSpace.id;
        const isEditing = editingSpaceId === homeSpace.id;
        const actionPending = accountData.activating
          || accountData.restoringManaged
          || accountData.migratingManaged
          || accountData.renamingHomeSpace
          || accountData.settingDefaultHomeSpace
          || accountData.removingHomeSpace
          || activationPending;
        const currentManagedRemovalBlocked = isCurrent && homeSpace.accessMode === "account-managed";
        const removeDisabled = actionPending || currentManagedRemovalBlocked;
        const actionPendingReason = actionPending ? t("settings.homeSpaces.actionPending") : undefined;
        const restoreDisabledReason = getRestoreManagedDisabledReason(storageReady, actionPending, t);
        const activateDisabledReason = getActivateSpaceDisabledReason(storageReady, actionPending, t);
        const removeDisabledReason = currentManagedRemovalBlocked
          ? t("settings.homeSpaces.removeBlocked")
          : actionPendingReason;

        return (
          <div className="home-space-item" key={homeSpace.id}>
            <div className="home-space-row">
              <div>
                <strong>{homeSpace.name}</strong>
                <span>{formatSettingsHomeSpaceAccessMode(homeSpace.accessMode, t)} · {shortenId(homeSpace.syncSpaceId)}{isCurrent ? ` · ${t("settings.homeSpaces.currentLocal")}` : ""}</span>
              </div>
              <div className="home-space-row-actions">
                <span>{homeSpace.isDefault ? t("settings.homeSpaces.defaultBadge") : t("settings.homeSpaces.spaceBadge")}</span>
                {!homeSpace.isDefault ? (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={actionPending}
                    title={actionPendingReason ?? t("settings.homeSpaces.setDefaultTitle")}
                    onClick={() => onSetDefault(homeSpace)}
                  >
                    {accountData.settingDefaultHomeSpace && defaultPendingSpaceId === homeSpace.id ? t("settings.homeSpaces.settingDefault") : t("settings.homeSpaces.setDefault")}
                  </button>
                ) : null}
                {isCurrent ? (
                  <span>{t("settings.homeSpaces.activeBadge")}</span>
                ) : homeSpace.accessMode === "account-managed" ? (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || actionPending}
                    title={restoreDisabledReason ?? t("settings.homeSpaces.restoreTitle")}
                    onClick={() => onRestoreManaged(homeSpace)}
                  >
                    {accountData.restoringManaged && managedRestoreSpaceId === homeSpace.id ? t("settings.homeSpaces.restoring") : t("settings.homeSpaces.restore")}
                  </button>
                ) : (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || actionPending}
                    title={activateDisabledReason ?? t("settings.homeSpaces.activateTitle")}
                    onClick={() => onSelectSpace(homeSpace.id)}
                  >
                    {isActive ? t("settings.common.cancel") : t("settings.homeSpaces.activate")}
                  </button>
                )}
                <button
                  className="utility-button"
                  type="button"
                  disabled={actionPending}
                  title={actionPendingReason ?? t("settings.homeSpaces.renameTitle")}
                  onClick={() => onStartRename(homeSpace)}
                >
                  {t("settings.homeSpaces.rename")}
                </button>
                <span
                  className="home-space-action-tooltip"
                  title={removeDisabledReason ?? t("settings.homeSpaces.removeTitle")}
                >
                  <button
                    className="danger-button"
                    type="button"
                    disabled={removeDisabled}
                    title={removeDisabledReason}
                    onClick={() => onRemove(homeSpace)}
                  >
                    {accountData.removingHomeSpace && removingSpaceId === homeSpace.id ? t("settings.homeSpaces.removing") : t("settings.homeSpaces.remove")}
                  </button>
                </span>
              </div>
            </div>

            {isEditing ? (
              <form className="home-space-inline-form" onSubmit={(event) => onRename(event, homeSpace)}>
                <label className="field">
                  <span>{t("settings.homeSpaces.nameLabel")}</span>
                  <input
                    type="text"
                    value={editingSpaceName}
                    maxLength={80}
                    disabled={accountData.renamingHomeSpace}
                    title={accountData.renamingHomeSpace ? t("settings.homeSpaces.renamePending") : undefined}
                    onChange={(event) => onChangeEditingName(event.target.value)}
                  />
                </label>
                <div className="home-space-inline-actions">
                  <button className="utility-button" type="button" disabled={accountData.renamingHomeSpace} title={accountData.renamingHomeSpace ? t("settings.homeSpaces.renamePending") : t("settings.homeSpaces.cancelRenameTitle")} onClick={onCancelRename}>{t("settings.common.cancel")}</button>
                  <button className="utility-button" type="submit" disabled={accountData.renamingHomeSpace || !editingSpaceName.trim()} title={getRenameSaveDisabledReason(accountData.renamingHomeSpace, editingSpaceName, t) ?? t("settings.homeSpaces.saveRenameTitle")}>
                    {accountData.renamingHomeSpace ? t("settings.homeSpaces.saving") : t("settings.homeSpaces.save")}
                  </button>
                </div>
              </form>
            ) : null}

            {isActive ? (
              <form className="home-space-activate-form" onSubmit={(event) => onActivate(event, homeSpace)}>
                <label className="field">
                  <span>{t("settings.homeSpaces.syncCodeLabel")}</span>
                  <input
                    type="text"
                    value={activationCode}
                    placeholder="hp1_..."
                    disabled={accountData.activating || activationPending}
                    title={accountData.activating || activationPending ? t("settings.homeSpaces.activatePending") : t("settings.homeSpaces.activateInputTitle")}
                    onChange={(event) => onChangeActivationCode(event.target.value)}
                  />
                </label>
                <button className="utility-button" type="submit" disabled={accountData.activating || activationPending || !activationCode.trim()} title={getActivationSubmitDisabledReason(accountData.activating || activationPending, activationCode, t) ?? t("settings.homeSpaces.activateSubmitTitle")}>
                  {accountData.activating || activationPending ? t("settings.homeSpaces.activating") : t("settings.homeSpaces.confirmActivate")}
                </button>
                {activationError ? <StatusMessage role="alert" tone="danger">{activationError}</StatusMessage> : null}
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function getCreateManagedDisabledReason(
  storageReady: boolean,
  accountReady: boolean,
  accountActionPending: boolean,
  t: ReturnType<typeof useI18n>["t"]
): string | undefined {
  if (!storageReady) {
    return t("settings.common.storageNotReady");
  }

  if (!accountReady) {
    return t("settings.homeSpaces.disabledAccountLoading");
  }

  if (accountActionPending) {
    return t("settings.homeSpaces.actionPending");
  }

  return undefined;
}

function getRestoreManagedDisabledReason(storageReady: boolean, actionPending: boolean, t: ReturnType<typeof useI18n>["t"]): string | undefined {
  if (!storageReady) {
    return t("settings.homeSpaces.disabledRestoreStorage");
  }

  if (actionPending) {
    return t("settings.homeSpaces.actionPending");
  }

  return undefined;
}

function getActivateSpaceDisabledReason(storageReady: boolean, actionPending: boolean, t: ReturnType<typeof useI18n>["t"]): string | undefined {
  if (!storageReady) {
    return t("settings.homeSpaces.disabledActivateStorage");
  }

  if (actionPending) {
    return t("settings.homeSpaces.actionPending");
  }

  return undefined;
}

function getRenameSaveDisabledReason(renaming: boolean, name: string, t: ReturnType<typeof useI18n>["t"]): string | undefined {
  if (renaming) {
    return t("settings.homeSpaces.renamePending");
  }

  if (!name.trim()) {
    return t("settings.homeSpaces.renameNameRequired");
  }

  return undefined;
}

function getActivationSubmitDisabledReason(actionPending: boolean, activationCode: string, t: ReturnType<typeof useI18n>["t"]): string | undefined {
  if (actionPending) {
    return t("settings.homeSpaces.activatePending");
  }

  if (!activationCode.trim()) {
    return t("settings.homeSpaces.activateCodeRequired");
  }

  return undefined;
}

function getMigrationBlockReason(status: HomeDocumentV2["syncMeta"]["status"], t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "conflict") {
    return t("settings.homeSpaces.migrationConflict");
  }

  if (status === "paused") {
    return t("settings.homeSpaces.migrationPaused");
  }

  return "";
}

function removeConfirmMessage(homeSpace: HomeSpace, isCurrent: boolean, t: ReturnType<typeof useI18n>["t"]): string {
  const defaultNote = homeSpace.isDefault ? t("settings.homeSpaces.removeDefaultNote") : "";
  const currentSyncNote = isCurrent && homeSpace.accessMode === "sync-code"
    ? t("settings.homeSpaces.removeCurrentSyncNote")
    : "";

  if (homeSpace.accessMode === "account-managed") {
    return [
      t("settings.homeSpaces.removeManagedTitle", { space: homeSpace.name }),
      t("settings.homeSpaces.removeManagedIndex"),
      t("settings.homeSpaces.removeManagedDevice"),
      t("settings.homeSpaces.removeManagedHistory"),
      defaultNote
    ].filter(Boolean).join("\n");
  }

  return [
    t("settings.homeSpaces.removeSyncTitle", { space: homeSpace.name }),
    t("settings.homeSpaces.removeSyncIndex"),
    t("settings.homeSpaces.removeSyncCode"),
    currentSyncNote,
    defaultNote
  ].filter(Boolean).join("\n");
}

function shortenId(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
