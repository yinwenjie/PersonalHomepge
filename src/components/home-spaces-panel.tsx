"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { HomeSpace } from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import { parseSyncCode, type StoredSyncBinding } from "@/domain/sync-code";
import type { AccountDataState } from "@/hooks/use-account-data";

interface HomeSpacesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
  currentBinding: StoredSyncBinding | null;
  documentValue: HomeDocumentV2;
  storageReady: boolean;
  onActivateHomeSpace: (homeSpace: HomeSpace, syncCode: string) => Promise<boolean>;
  onRestoreManagedHomeSpace: (homeSpace: HomeSpace) => Promise<boolean>;
  onManagedHomeSpaceCreated: (binding: StoredSyncBinding) => void;
}

export function HomeSpacesPanel({
  accountData,
  authLoading,
  signedIn,
  currentBinding,
  documentValue,
  storageReady,
  onActivateHomeSpace,
  onRestoreManagedHomeSpace,
  onManagedHomeSpaceCreated
}: HomeSpacesPanelProps) {
  const [claimSpaceName, setClaimSpaceName] = useState("我的首页");
  const [managedSpaceName, setManagedSpaceName] = useState("我的首页");
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState("");
  const [activationError, setActivationError] = useState("");
  const [activationPending, setActivationPending] = useState(false);
  const [managedRestoreSpaceId, setManagedRestoreSpaceId] = useState<string | null>(null);
  const accountReady = Boolean(accountData.profile && accountData.preferences && !accountData.loading);
  const currentHomeSpace = useMemo(() => {
    if (!currentBinding) {
      return null;
    }

    return accountData.homeSpaces.find((homeSpace) => homeSpace.syncSpaceId === currentBinding.spaceId) ?? null;
  }, [accountData.homeSpaces, currentBinding]);

  async function handleClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await accountData.claimHomeSpace(currentBinding?.spaceId ?? "", claimSpaceName);
  }

  async function handleCreateManaged(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady || !accountReady || accountData.creatingManaged || accountData.restoringManaged) {
      return;
    }

    const binding = await accountData.createAccountManagedHomeSpace(managedSpaceName, documentValue);
    if (binding) {
      onManagedHomeSpaceCreated(binding);
    }
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

    setManagedRestoreSpaceId(homeSpace.id);
    try {
      await onRestoreManagedHomeSpace(homeSpace);
    } finally {
      setManagedRestoreSpaceId(null);
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
          <p className="form-error">{accountData.error}</p>
        </div>
      ) : (
        <>
          <form className="home-space-create-form" onSubmit={handleCreateManaged}>
            <label className="field">
              <span>账号托管空间名称</span>
              <input
                type="text"
                value={managedSpaceName}
                maxLength={80}
                disabled={!storageReady || !accountReady || accountData.creatingManaged || accountData.restoringManaged}
                onChange={(event) => setManagedSpaceName(event.target.value)}
              />
            </label>
            <button className="utility-button" type="submit" disabled={!storageReady || !accountReady || accountData.creatingManaged || accountData.restoringManaged}>
              {accountData.creatingManaged ? "创建中" : "创建账号托管空间"}
            </button>
          </form>

          {!currentBinding ? (
            <div className="settings-placeholder">
              <strong>当前浏览器未绑定同步码</strong>
              <p>可创建账号托管空间，或先在同步码区域创建/绑定同步码后再认领。</p>
            </div>
          ) : currentHomeSpace ? (
            <div className="settings-placeholder">
              <strong>当前首页空间已在账号中</strong>
              <p>{currentHomeSpace.name} 已在当前账号的首页空间列表中。</p>
            </div>
          ) : (
            <form className="home-space-claim-form" onSubmit={handleClaim}>
              <label className="field">
                <span>空间名称</span>
                <input
                  type="text"
                  value={claimSpaceName}
                  maxLength={80}
                  disabled={accountData.claiming}
                  onChange={(event) => setClaimSpaceName(event.target.value)}
                />
              </label>
              <button className="utility-button" type="submit" disabled={accountData.claiming}>
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
            managedRestoreSpaceId={managedRestoreSpaceId}
            storageReady={storageReady}
            onActivate={handleActivate}
            onChangeActivationCode={setActivationCode}
            onRestoreManaged={handleRestoreManaged}
            onSelectSpace={(spaceId) => {
              setActivationError("");
              setActivationCode("");
              setActiveSpaceId((current) => current === spaceId ? null : spaceId);
            }}
          />

          <p className={accountData.claimError || accountData.activationError || accountData.managedCreateError || accountData.managedRestoreError ? "form-error" : "save-status"}>
            {accountData.managedCreateError
              || accountData.managedRestoreError
              || accountData.claimError
              || accountData.activationError
              || accountData.managedRestoreMessage
              || accountData.managedCreateMessage
              || accountData.claimMessage
              || accountData.activationMessage
              || "账号托管空间不显示完整同步码；同步码空间仍需完整同步码激活。"}
          </p>
        </>
      )}
    </section>
  );
}

function HomeSpaceList({
  accountData,
  activationCode,
  activationError,
  activationPending,
  activeSpaceId,
  currentSpaceId,
  managedRestoreSpaceId,
  storageReady,
  onActivate,
  onChangeActivationCode,
  onRestoreManaged,
  onSelectSpace
}: {
  accountData: AccountDataState;
  activationCode: string;
  activationError: string;
  activationPending: boolean;
  activeSpaceId: string | null;
  currentSpaceId: string | null;
  managedRestoreSpaceId: string | null;
  storageReady: boolean;
  onActivate: (event: FormEvent<HTMLFormElement>, homeSpace: HomeSpace) => Promise<void>;
  onChangeActivationCode: (value: string) => void;
  onRestoreManaged: (homeSpace: HomeSpace) => Promise<void>;
  onSelectSpace: (spaceId: string) => void;
}) {
  if (accountData.loading) {
    return <p className="save-status">正在读取首页空间。</p>;
  }

  if (accountData.homeSpaces.length === 0) {
    return <p className="save-status">当前账号还没有认领首页空间。</p>;
  }

  return (
    <div className="home-space-list">
      {accountData.homeSpaces.map((homeSpace) => {
        const isCurrent = homeSpace.syncSpaceId === currentSpaceId;
        const isActive = activeSpaceId === homeSpace.id;

        return (
          <div className="home-space-item" key={homeSpace.id}>
            <div className="home-space-row">
              <div>
                <strong>{homeSpace.name}</strong>
                <span>{accessModeLabel(homeSpace.accessMode)} · {shortenId(homeSpace.syncSpaceId)}{isCurrent ? " · 当前本机" : ""}</span>
              </div>
              <div className="home-space-row-actions">
                <span>{homeSpace.isDefault ? "默认" : "空间"}</span>
                {isCurrent ? (
                  <span>已激活</span>
                ) : homeSpace.accessMode === "account-managed" ? (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || accountData.restoringManaged || accountData.activating || activationPending}
                    onClick={() => onRestoreManaged(homeSpace)}
                  >
                    {accountData.restoringManaged && managedRestoreSpaceId === homeSpace.id ? "恢复中" : "恢复"}
                  </button>
                ) : (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={!storageReady || accountData.activating || activationPending}
                    onClick={() => onSelectSpace(homeSpace.id)}
                  >
                    {isActive ? "取消" : "激活"}
                  </button>
                )}
              </div>
            </div>

            {isActive ? (
              <form className="home-space-activate-form" onSubmit={(event) => onActivate(event, homeSpace)}>
                <label className="field">
                  <span>完整同步码</span>
                  <input
                    type="text"
                    value={activationCode}
                    placeholder="hp1_..."
                    disabled={accountData.activating || activationPending}
                    onChange={(event) => onChangeActivationCode(event.target.value)}
                  />
                </label>
                <button className="utility-button" type="submit" disabled={accountData.activating || activationPending || !activationCode.trim()}>
                  {accountData.activating || activationPending ? "激活中" : "确认激活"}
                </button>
                {activationError ? <p className="form-error">{activationError}</p> : null}
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
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
