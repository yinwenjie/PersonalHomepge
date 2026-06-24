"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
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
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";

interface HomeSpacesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
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

const DEFAULT_MANAGED_SPACE_NAME = "我的首页";
const DEFAULT_TEMPLATE_ID = HOME_TEMPLATES.find((template) => template.id === "minimal")?.id ?? HOME_TEMPLATES[0].id;

export function HomeSpacesPanel({
  accountData,
  authLoading,
  signedIn,
  currentBinding,
  documentValue,
  storageReady,
  onActivateHomeSpace,
  onBeforeOverwrite,
  onRestoreManagedHomeSpace,
  onMigrateSyncCodeHomeSpace,
  onManagedHomeSpaceCreated
}: HomeSpacesPanelProps) {
  const [claimSpaceName, setClaimSpaceName] = useState("我的首页");
  const [createDialog, setCreateDialog] = useState<CreateSpaceDialog>(null);
  const [currentCreateName, setCurrentCreateName] = useState(DEFAULT_MANAGED_SPACE_NAME);
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
  const migrationBlockReason = getMigrationBlockReason(documentValue.syncMeta.status);
  const canMigrateCurrentHomeSpace = Boolean(
    currentHomeSpace
      && currentBinding?.accessMode === "sync-code"
      && currentHomeSpace.accessMode === "sync-code"
  );
  const createManagedDisabledReason = getCreateManagedDisabledReason(storageReady, accountReady, accountActionPending);
  const claimDisabledReason = accountActionPending ? "账号空间操作处理中，请稍后。" : undefined;
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
    || "账号托管空间不显示完整同步码；从账号移除不会废弃底层同步空间。";
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
  }

  async function handleCreateManaged(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady || !accountReady || accountActionPending) {
      return;
    }

    const binding = await accountData.createAccountManagedHomeSpace(currentCreateName.trim() || DEFAULT_MANAGED_SPACE_NAME, documentValue);
    if (binding) {
      onManagedHomeSpaceCreated(binding, documentValue);
      setCreateDialog(null);
      setCurrentCreateName(DEFAULT_MANAGED_SPACE_NAME);
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
      window.alert("未能保存当前首页，已取消创建并切换模板空间。");
      return;
    }

    setCreatingTemplateId(selectedTemplate.id);
    try {
      const binding = await accountData.createAccountManagedHomeSpace(spaceName, templateDocument);
      if (binding) {
        onManagedHomeSpaceCreated(binding, templateDocument);
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
        setActivationError("同步码不属于所选首页空间。");
        return;
      }
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : "同步码格式不正确。");
      return;
    }

    if (!window.confirm("激活该首页空间会拉取云端首页并覆盖当前浏览器本地首页，继续？")) {
      return;
    }

    if (!onBeforeOverwrite("before-home-space-activate")) {
      setActivationError("未能保存当前首页，已取消激活首页空间。");
      return;
    }

    setActivationPending(true);
    try {
      const activated = await onActivateHomeSpace(homeSpace, normalizedCode);
      if (activated) {
        setActivationCode("");
        setActiveSpaceId(null);
      }
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : "首页空间激活失败。");
    } finally {
      setActivationPending(false);
    }
  }

  async function handleRestoreManaged(homeSpace: HomeSpace) {
    setActivationError("");
    setActivationCode("");
    setActiveSpaceId(null);

    if (!window.confirm("恢复该账号托管空间会拉取云端首页并覆盖当前浏览器本地首页，继续？")) {
      return;
    }

    if (!onBeforeOverwrite("before-managed-home-space-restore")) {
      setActivationError("未能保存当前首页，已取消恢复账号托管空间。");
      return;
    }

    setManagedRestoreSpaceId(homeSpace.id);
    try {
      await onRestoreManagedHomeSpace(homeSpace);
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

    if (!window.confirm("迁移为账号托管后，当前账号会保存该空间的托管恢复凭证，空白设备可登录账号恢复。旧同步码本阶段不会自动废弃，仍可继续使用。继续？")) {
      return;
    }

    setManagedMigrationSpaceId(homeSpace.id);
    try {
      await onMigrateSyncCodeHomeSpace(homeSpace);
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

    if (!window.confirm(removeConfirmMessage(homeSpace, isCurrent))) {
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
    } finally {
      setRemovingSpaceId(null);
    }
  }

  return (
    <section className="settings-panel" aria-label="首页空间">
      <div className="panel-header">
        <h2>首页空间</h2>
        <span>{signedIn ? `${accountData.homeSpaces.length} spaces` : "Sign in"}</span>
      </div>

      {authLoading ? (
        <div className="settings-placeholder">
          <strong>正在读取账号状态</strong>
          <p>账号状态确认后，可以管理当前账号下的首页空间。</p>
        </div>
      ) : !signedIn ? (
        <div className="settings-placeholder">
          <strong>登录后认领同步码首页</strong>
          <p>账号只保存首页空间索引，不保存同步码 secret。</p>
        </div>
      ) : accountData.error ? (
        <div className="settings-placeholder">
          <strong>首页空间暂不可用</strong>
          <StatusMessage role="alert" tone="danger">{accountData.error}</StatusMessage>
        </div>
      ) : (
        <>
          <div className="home-space-create-actions">
            <button
              className="utility-button"
              type="button"
              disabled={Boolean(createManagedDisabledReason)}
              title={createManagedDisabledReason ?? "使用当前浏览器首页创建账号托管空间"}
              onClick={() => {
                setCurrentCreateName(DEFAULT_MANAGED_SPACE_NAME);
                setCreateDialog("current");
              }}
            >
              使用当前首页创建空间
            </button>
            <button
              className="utility-button"
              type="button"
              disabled={Boolean(createManagedDisabledReason)}
              title={createManagedDisabledReason ?? "从模板创建新的账号托管空间"}
              onClick={() => {
                setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
                setTemplateSpaceName("");
                setCreateDialog("template-select");
              }}
            >
              从模板创建新空间
            </button>
          </div>

          {!currentBinding ? (
            <div className="settings-placeholder">
              <strong>当前浏览器未绑定同步码</strong>
              <p>可创建账号托管空间，或在离线同步码与恢复中创建/绑定普通同步码后再认领。</p>
            </div>
          ) : currentHomeSpace ? (
            <div className="settings-placeholder">
              <strong>当前首页空间已在账号中</strong>
              <p>{currentHomeSpace.name} 已在当前账号的首页空间列表中。</p>
              {canMigrateCurrentHomeSpace ? (
                <>
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || !accountReady || accountActionPending || Boolean(migrationBlockReason)}
                    title={migrationBlockReason || createManagedDisabledReason || "把当前已认领普通同步码空间迁移为账号托管"}
                    onClick={() => handleMigrateSyncCode(currentHomeSpace)}
                  >
                    {accountData.migratingManaged && managedMigrationSpaceId === currentHomeSpace.id ? "迁移中" : "迁移为账号托管"}
                  </button>
                  {migrationBlockReason ? <StatusMessage role="alert" tone="warning">{migrationBlockReason}</StatusMessage> : null}
                </>
              ) : null}
            </div>
          ) : (
            <form className="home-space-claim-form" onSubmit={handleClaim}>
              <label className="field">
                <span>空间名称</span>
                <input
                  type="text"
                  value={claimSpaceName}
                  maxLength={80}
                  disabled={accountActionPending}
                  title={claimDisabledReason}
                  onChange={(event) => setClaimSpaceName(event.target.value)}
                />
              </label>
              <button className="utility-button" type="submit" disabled={accountActionPending} title={claimDisabledReason ?? "把当前同步码空间记录到账号首页空间列表"}>
                {accountData.claiming ? "认领中" : "认领当前首页空间"}
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
              onUseDefaultName={() => setCurrentCreateName(DEFAULT_MANAGED_SPACE_NAME)}
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
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function CurrentHomeSpaceCreateDialog({
  actionPending,
  disabledReason,
  name,
  onCancel,
  onChangeName,
  onSubmit,
  onUseDefaultName
}: {
  actionPending: boolean;
  disabledReason?: string;
  name: string;
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
            <h2 id="currentHomeSpaceCreateTitle">使用当前首页创建空间</h2>
            <p>创建成功后，当前浏览器会切换到新的账号托管空间。</p>
          </div>
          <button className="mini-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <div className="settings-dialog-body">
          <label className="field">
            <span>空间名称</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              disabled={actionPending}
              placeholder={DEFAULT_MANAGED_SPACE_NAME}
              onChange={(event) => onChangeName(event.target.value)}
            />
          </label>
          <button className="utility-button" type="button" disabled={actionPending} onClick={onUseDefaultName}>
            使用默认名称
          </button>
          <StatusMessage>
            当前首页内容会复制到新空间；已有账号空间、同步码和云端内容不会删除。
          </StatusMessage>
        </div>
        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" disabled={actionPending} onClick={onCancel}>取消</button>
          <button className="utility-button" type="submit" disabled={actionPending || Boolean(disabledReason)} title={disabledReason ?? "确认创建账号托管空间"}>
            {actionPending ? "创建中" : "确认创建"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TemplateHomeSpaceSelectDialog({
  actionPending,
  disabledReason,
  selectedTemplate,
  selectedTemplateId,
  onCancel,
  onSelectTemplate,
  onSubmit
}: {
  actionPending: boolean;
  disabledReason?: string;
  selectedTemplate: HomeTemplate;
  selectedTemplateId: HomeTemplateId;
  onCancel: () => void;
  onSelectTemplate: (templateId: HomeTemplateId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="templateHomeSpaceCreateTitle">
      <form className="settings-dialog settings-dialog-wide home-space-template-dialog" onSubmit={onSubmit}>
        <div className="settings-dialog-header">
          <div>
            <h2 id="templateHomeSpaceCreateTitle">从模板创建新空间</h2>
            <p>选择模板后会创建新的账号托管空间，并切换当前浏览器到该空间。</p>
          </div>
          <button className="mini-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <div className="settings-dialog-body">
          <div className="template-choice-grid" role="radiogroup" aria-label="模板选择">
            {HOME_TEMPLATES.map((template) => {
              const summary = summarizeHomeTemplate(template);
              const selected = selectedTemplateId === template.id;

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
                  <strong>{template.name}</strong>
                  <span>{summary.groupCount} 个分组 · {summary.siteCount} 个网站 · {summary.widgetCount} 个组件</span>
                </button>
              );
            })}
          </div>
          <StatusMessage>
            将使用“{selectedTemplate.name}”创建“{selectedTemplate.recommendedSpaceName}”。当前本地首页会被新空间内容替换。
          </StatusMessage>
        </div>
        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" disabled={actionPending} onClick={onCancel}>取消</button>
          <button className="utility-button" type="submit" disabled={actionPending || Boolean(disabledReason)} title={disabledReason ?? `确认使用“${selectedTemplate.name}”模板`}>
            确认
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
  onCancel: () => void;
  onChangeName: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="templateHomeSpaceNameTitle">
      <form className="settings-dialog home-space-create-dialog" onSubmit={onSubmit}>
        <div className="settings-dialog-header">
          <div>
            <h2 id="templateHomeSpaceNameTitle">命名新空间</h2>
            <p>将从“{selectedTemplate.name}”创建新的账号托管空间。</p>
          </div>
          <button className="mini-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <div className="settings-dialog-body">
          <label className="field">
            <span>空间名称</span>
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
            创建成功后，当前浏览器会切换到这个新空间，并显示模板生成的首页。
          </StatusMessage>
        </div>
        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" disabled={actionPending} onClick={onCancel}>取消</button>
          <button className="utility-button" type="submit" disabled={actionPending || Boolean(disabledReason)} title={disabledReason ?? `确认从“${selectedTemplate.name}”创建空间`}>
            {actionPending && creatingTemplateId === selectedTemplateId ? "创建中" : "确认创建"}
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
    return <StatusMessage>正在读取首页空间。</StatusMessage>;
  }

  if (accountData.homeSpaces.length === 0) {
    return <StatusMessage>当前账号还没有认领首页空间。</StatusMessage>;
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
        const actionPendingReason = actionPending ? "首页空间操作处理中，请稍后。" : undefined;
        const restoreDisabledReason = getRestoreManagedDisabledReason(storageReady, actionPending);
        const activateDisabledReason = getActivateSpaceDisabledReason(storageReady, actionPending);
        const removeDisabledReason = currentManagedRemovalBlocked
          ? "当前本机账号托管空间不能直接从账号移除；请先解除本机或切换到其他空间。"
          : actionPendingReason;

        return (
          <div className="home-space-item" key={homeSpace.id}>
            <div className="home-space-row">
              <div>
                <strong>{homeSpace.name}</strong>
                <span>{accessModeLabel(homeSpace.accessMode)} · {shortenId(homeSpace.syncSpaceId)}{isCurrent ? " · 当前本机" : ""}</span>
              </div>
              <div className="home-space-row-actions">
                <span>{homeSpace.isDefault ? "默认" : "空间"}</span>
                {!homeSpace.isDefault ? (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={actionPending}
                    title={actionPendingReason ?? "把该空间设为账号默认首页空间"}
                    onClick={() => onSetDefault(homeSpace)}
                  >
                    {accountData.settingDefaultHomeSpace && defaultPendingSpaceId === homeSpace.id ? "设置中" : "设默认"}
                  </button>
                ) : null}
                {isCurrent ? (
                  <span>已激活</span>
                ) : homeSpace.accessMode === "account-managed" ? (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || actionPending}
                    title={restoreDisabledReason ?? "恢复该账号托管空间到当前浏览器"}
                    onClick={() => onRestoreManaged(homeSpace)}
                  >
                    {accountData.restoringManaged && managedRestoreSpaceId === homeSpace.id ? "恢复中" : "恢复"}
                  </button>
                ) : (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || actionPending}
                    title={activateDisabledReason ?? "输入完整同步码后激活该普通同步码空间"}
                    onClick={() => onSelectSpace(homeSpace.id)}
                  >
                    {isActive ? "取消" : "激活"}
                  </button>
                )}
                <button
                  className="utility-button"
                  type="button"
                  disabled={actionPending}
                  title={actionPendingReason ?? "重命名该首页空间"}
                  onClick={() => onStartRename(homeSpace)}
                >
                  重命名
                </button>
                <span
                  className="home-space-action-tooltip"
                  title={removeDisabledReason ?? "从账号移除该首页空间索引；不会废弃底层同步空间"}
                >
                  <button
                    className="danger-button"
                    type="button"
                    disabled={removeDisabled}
                    title={removeDisabledReason}
                    onClick={() => onRemove(homeSpace)}
                  >
                    {accountData.removingHomeSpace && removingSpaceId === homeSpace.id ? "移除中" : "从账号移除"}
                  </button>
                </span>
              </div>
            </div>

            {isEditing ? (
              <form className="home-space-inline-form" onSubmit={(event) => onRename(event, homeSpace)}>
                <label className="field">
                  <span>空间名称</span>
                  <input
                    type="text"
                    value={editingSpaceName}
                    maxLength={80}
                    disabled={accountData.renamingHomeSpace}
                    title={accountData.renamingHomeSpace ? "首页空间正在重命名，请稍后。" : undefined}
                    onChange={(event) => onChangeEditingName(event.target.value)}
                  />
                </label>
                <div className="home-space-inline-actions">
                  <button className="utility-button" type="button" disabled={accountData.renamingHomeSpace} title={accountData.renamingHomeSpace ? "首页空间正在重命名，请稍后。" : "取消重命名"} onClick={onCancelRename}>取消</button>
                  <button className="utility-button" type="submit" disabled={accountData.renamingHomeSpace || !editingSpaceName.trim()} title={getRenameSaveDisabledReason(accountData.renamingHomeSpace, editingSpaceName) ?? "保存新的首页空间名称"}>
                    {accountData.renamingHomeSpace ? "保存中" : "保存"}
                  </button>
                </div>
              </form>
            ) : null}

            {isActive ? (
              <form className="home-space-activate-form" onSubmit={(event) => onActivate(event, homeSpace)}>
                <label className="field">
                  <span>完整同步码</span>
                  <input
                    type="text"
                    value={activationCode}
                    placeholder="hp1_..."
                    disabled={accountData.activating || activationPending}
                    title={accountData.activating || activationPending ? "首页空间正在激活，请稍后。" : "输入该首页空间对应的完整同步码"}
                    onChange={(event) => onChangeActivationCode(event.target.value)}
                  />
                </label>
                <button className="utility-button" type="submit" disabled={accountData.activating || activationPending || !activationCode.trim()} title={getActivationSubmitDisabledReason(accountData.activating || activationPending, activationCode) ?? "确认拉取该空间云端首页并覆盖当前本地首页"}>
                  {accountData.activating || activationPending ? "激活中" : "确认激活"}
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
  accountActionPending: boolean
): string | undefined {
  if (!storageReady) {
    return "本地存储尚未就绪，请稍后重试。";
  }

  if (!accountReady) {
    return "账号资料和偏好仍在读取，请稍后。";
  }

  if (accountActionPending) {
    return "账号空间操作处理中，请稍后。";
  }

  return undefined;
}

function getRestoreManagedDisabledReason(storageReady: boolean, actionPending: boolean): string | undefined {
  if (!storageReady) {
    return "本地存储尚未就绪，不能恢复账号托管空间。";
  }

  if (actionPending) {
    return "首页空间操作处理中，请稍后。";
  }

  return undefined;
}

function getActivateSpaceDisabledReason(storageReady: boolean, actionPending: boolean): string | undefined {
  if (!storageReady) {
    return "本地存储尚未就绪，不能激活首页空间。";
  }

  if (actionPending) {
    return "首页空间操作处理中，请稍后。";
  }

  return undefined;
}

function getRenameSaveDisabledReason(renaming: boolean, name: string): string | undefined {
  if (renaming) {
    return "首页空间正在重命名，请稍后。";
  }

  if (!name.trim()) {
    return "请输入首页空间名称。";
  }

  return undefined;
}

function getActivationSubmitDisabledReason(actionPending: boolean, activationCode: string): string | undefined {
  if (actionPending) {
    return "首页空间正在激活，请稍后。";
  }

  if (!activationCode.trim()) {
    return "请输入完整同步码。";
  }

  return undefined;
}

function getMigrationBlockReason(status: HomeDocumentV2["syncMeta"]["status"]): string {
  if (status === "conflict") {
    return "当前存在同步冲突，请先选择云端版本或本地版本后再迁移。";
  }

  if (status === "paused") {
    return "同步已暂停，请先选择上传本地、拉取云端、解除本机或恢复备份。";
  }

  return "";
}

function removeConfirmMessage(homeSpace: HomeSpace, isCurrent: boolean): string {
  const defaultNote = homeSpace.isDefault ? "它当前是默认空间，从账号移除后默认空间设置会被清空。" : "";
  const currentSyncNote = isCurrent && homeSpace.accessMode === "sync-code"
    ? "当前浏览器仍会保留本机同步码绑定，并可继续作为普通同步码空间同步。"
    : "";

  if (homeSpace.accessMode === "account-managed") {
    return [
      `从账号移除“${homeSpace.name}”？`,
      "这只会删除账号侧首页空间索引和托管恢复凭证。",
      "空白设备将不能再通过账号恢复它。",
      "底层同步空间不会删除、不会废弃，也不会执行密钥轮换。",
      defaultNote
    ].filter(Boolean).join("\n");
  }

  return [
    `从账号移除“${homeSpace.name}”？`,
    "这只会删除账号侧首页空间索引。",
    "同步码本身和云端内容不会删除，也不会废弃旧同步码。",
    currentSyncNote,
    defaultNote
  ].filter(Boolean).join("\n");
}

function shortenId(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function accessModeLabel(accessMode: HomeSpace["accessMode"]): string {
  if (accessMode === "account-managed") {
    return "账号托管";
  }

  if (accessMode === "password-protected") {
    return "密码保护";
  }

  return "同步码";
}
