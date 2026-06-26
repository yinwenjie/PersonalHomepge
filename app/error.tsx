"use client";

import { useEffect } from "react";
import Link from "next/link";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientError(error, {
      eventType: "react_render_error",
      operation: "next.route-error",
      properties: {
        runtime: "next",
        source: "app-error"
      },
      severity: "fatal"
    });
  }, [error]);

  return (
    <main className="runtime-error-screen">
      <section className="runtime-error-panel" role="alert">
        <span className="runtime-error-kicker">Page Error</span>
        <h1>页面暂时无法继续显示</h1>
        <p>已保护当前浏览器中的本地数据。可以重试当前页面，或返回首页重新进入。</p>
        <div className="runtime-error-actions">
          <button className="utility-button" type="button" onClick={reset}>
            重试
          </button>
          <Link className="utility-button" href="/">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
