"use client";

import { useEffect, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import {
  PRODUCT_ANALYTICS_UPDATED_EVENT,
  loadProductAnalyticsPreferences,
  setProductAnalyticsEnabled
} from "@/infrastructure/product-analytics-repository";

export function ProductAnalyticsSettingsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function refresh() {
      const preferences = loadProductAnalyticsPreferences();
      setEnabled(preferences.enabled);
      setReady(true);
    }

    refresh();
    window.addEventListener(PRODUCT_ANALYTICS_UPDATED_EVENT, refresh);

    return () => window.removeEventListener(PRODUCT_ANALYTICS_UPDATED_EVENT, refresh);
  }, []);

  function handleToggle(nextEnabled: boolean) {
    const preferences = setProductAnalyticsEnabled(nextEnabled);
    setEnabled(preferences.enabled);
    setReady(true);
  }

  return (
    <div className="advanced-operation-block">
      <div className="advanced-operation-head">
        <h3>产品改进</h3>
        <span>Analytics</span>
      </div>
      <label className="analytics-toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!ready}
          onChange={(event) => handleToggle(event.target.checked)}
        />
        <span>允许匿名基础埋点</span>
      </label>
      <StatusMessage tone="neutral">
        只记录白名单功能事件和数量级，不上传网站 URL、搜索词、首页内容、同步码或账号托管凭证。
      </StatusMessage>
    </div>
  );
}
