"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { HomeSpace } from "@/domain/account";
import { parseSyncCode, type StoredSyncBinding } from "@/domain/sync-code";
import type { AccountDataState } from "@/hooks/use-account-data";

interface HomeSpacesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
  currentBinding: StoredSyncBinding | null;
  onActivateHomeSpace: (homeSpace: HomeSpace, syncCode: string) => Promise<boolean>;
}

export function HomeSpacesPanel({
  accountData,
  authLoading,
  signedIn,
  currentBinding,
  onActivateHomeSpace
}: HomeSpacesPanelProps) {
  const [spaceName, setSpaceName] = useState("我的首页");
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState("");
  const [activationError, setActivationError] = useState("");
  const [activationPending, setActivationPending] = useState(false);
  const currentHomeSpace = useMemo(() => {
    if (!currentBinding) {
      return null;
    }

    return accountData.homeSpaces.find((homeSpace) => homeSpace.syncSpaceId === currentBinding.spaceId) ?? null;
  }, [accountData.homeSpaces, currentBinding]);

  async function handleClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await accountData.claimHomeSpace(currentBinding?.spaceId ?? "", spaceName);
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
          {!currentBinding ? (
            <div className="settings-placeholder">
              <strong>当前浏览器未绑定同步码</strong>
              <p>请先在同步码区域创建或绑定同步码，再将这个首页空间认领到账号。</p>
            </div>
          ) : currentHomeSpace ? (
            <div className="settings-placeholder">
              <strong>当前同步空间已认领</strong>
              <p>{currentHomeSpace.name} 已在当前账号的首页空间列表中。</p>
            </div>
          ) : (
            <form className="home-space-claim-form" onSubmit={handleClaim}>
              <label className="field">
                <span>空间名称</span>
                <input
                  type="text"
                  value={spaceName}
                  maxLength={80}
                  disabled={accountData.claiming}
                  onChange={(event) => setSpaceName(event.target.value)}
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
            onActivate={handleActivate}
            onChangeActivationCode={setActivationCode}
            onSelectSpace={(spaceId) => {
              setActivationError("");
              setActivationCode("");
              setActiveSpaceId((current) => current === spaceId ? null : spaceId);
            }}
          />

          <p className={accountData.claimError || accountData.activationError ? "form-error" : "save-status"}>
            {accountData.claimError
              || accountData.activationError
              || accountData.claimMessage
              || accountData.activationMessage
              || "空间列表只保存账号索引；新设备仍需完整同步码才能激活空间。"}
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
  onActivate,
  onChangeActivationCode,
  onSelectSpace
}: {
  accountData: AccountDataState;
  activationCode: string;
  activationError: string;
  activationPending: boolean;
  activeSpaceId: string | null;
  currentSpaceId: string | null;
  onActivate: (event: FormEvent<HTMLFormElement>, homeSpace: HomeSpace) => Promise<void>;
  onChangeActivationCode: (value: string) => void;
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
                <span>{shortenId(homeSpace.syncSpaceId)}{isCurrent ? " · 当前本机" : ""}</span>
              </div>
              <div className="home-space-row-actions">
                <span>{homeSpace.isDefault ? "默认" : "空间"}</span>
                {isCurrent ? (
                  <span>已激活</span>
                ) : (
                  <button
                    className="utility-button"
                    type="button"
                    disabled={accountData.activating || activationPending}
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
