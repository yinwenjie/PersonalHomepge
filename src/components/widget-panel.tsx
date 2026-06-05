"use client";

import Link from "next/link";
import { type HomeDocumentV2, isUngroupedGroup } from "@/domain/home-document";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

interface WidgetPanelProps {
  documentValue: HomeDocumentV2;
  updatedLabel: string;
}

export function WidgetPanel({ documentValue, updatedLabel }: WidgetPanelProps) {
  const siteCount = documentValue.groups.reduce((sum, group) => sum + group.sites.length, 0);
  const groupCount = documentValue.groups.filter((group) => !isUngroupedGroup(group)).length;
  const { user, loading } = useSupabaseAuth();
  const accountLabel = user?.email ?? "Local";
  const accountSub = loading ? "读取账号状态" : user ? "账号已登录" : "本地模式";
  const accountInitial = getAccountInitial(user?.email);

  return (
    <aside className="sidebar" aria-label="状态和组件">
      <section className="status-panel">
        <div className="status-head">
          <span className="avatar">{accountInitial}</span>
          <div className="status-copy">
            <div className="status-title-row">
              <p className="status-title">{accountLabel}</p>
              <Link className="settings-button" href="/edit" aria-label="打开编辑页面" title="编辑首页">
                <span aria-hidden="true">⚙</span>
              </Link>
            </div>
            <p className="status-sub">{accountSub}</p>
          </div>
        </div>
        <div className="metrics">
          <div>
            <strong>{groupCount}</strong>
            <span>分组</span>
          </div>
          <div>
            <strong>{siteCount}</strong>
            <span>网站</span>
          </div>
          <div>
            <strong>{documentValue.widgets.length}</strong>
            <span>组件</span>
          </div>
          <div>
            <strong>{documentValue.revision}</strong>
            <span>修订</span>
          </div>
        </div>
        <div className="sync-row">
          <span className="dot" />
          <span>{documentValue.syncMeta.status}</span>
        </div>
        <p className="updated-line">更新于 {updatedLabel}</p>
      </section>

      <section className="widget-panel">
        <div className="panel-header">
          <h2>组件</h2>
          <span>registry</span>
        </div>
        <div className="widget-list">
          <span>calendar.month</span>
          <span>todo.list</span>
        </div>
      </section>
    </aside>
  );
}

function getAccountInitial(email?: string): string {
  const value = email?.trim();
  if (!value) {
    return "L";
  }

  return value.slice(0, 1).toUpperCase();
}
