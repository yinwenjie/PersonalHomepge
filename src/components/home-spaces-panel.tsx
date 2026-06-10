"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { StoredSyncBinding } from "@/domain/sync-code";
import type { AccountDataState } from "@/hooks/use-account-data";

interface HomeSpacesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
  currentBinding: StoredSyncBinding | null;
}

export function HomeSpacesPanel({
  accountData,
  authLoading,
  signedIn,
  currentBinding
}: HomeSpacesPanelProps) {
  const [spaceName, setSpaceName] = useState("我的首页");
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

          <HomeSpaceList accountData={accountData} currentSpaceId={currentBinding?.spaceId ?? null} />

          <p className={accountData.claimError ? "form-error" : "save-status"}>
            {accountData.claimError
              || accountData.claimMessage
              || "空间列表只保存账号索引；新设备仍需完整同步码才能激活空间。"}
          </p>
        </>
      )}
    </section>
  );
}

function HomeSpaceList({
  accountData,
  currentSpaceId
}: {
  accountData: AccountDataState;
  currentSpaceId: string | null;
}) {
  if (accountData.loading) {
    return <p className="save-status">正在读取首页空间。</p>;
  }

  if (accountData.homeSpaces.length === 0) {
    return <p className="save-status">当前账号还没有认领首页空间。</p>;
  }

  return (
    <div className="home-space-list">
      {accountData.homeSpaces.map((homeSpace) => (
        <div className="home-space-row" key={homeSpace.id}>
          <div>
            <strong>{homeSpace.name}</strong>
            <span>{shortenId(homeSpace.syncSpaceId)}{homeSpace.syncSpaceId === currentSpaceId ? " · 当前本机" : ""}</span>
          </div>
          <span>{homeSpace.isDefault ? "默认" : "空间"}</span>
        </div>
      ))}
    </div>
  );
}

function shortenId(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
