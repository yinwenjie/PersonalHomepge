"use client";

import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import Link from "next/link";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";

interface ErrorMonitorBoundaryProps {
  children: ReactNode;
}

interface ErrorMonitorBoundaryState {
  errorId: string | null;
  hasError: boolean;
}

export class ErrorMonitorBoundary extends Component<ErrorMonitorBoundaryProps, ErrorMonitorBoundaryState> {
  state: ErrorMonitorBoundaryState = {
    errorId: null,
    hasError: false
  };

  static getDerivedStateFromError(): ErrorMonitorBoundaryState {
    return {
      errorId: null,
      hasError: true
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const errorId = captureClientError(error, {
      componentStack: errorInfo.componentStack,
      eventType: "react_render_error",
      operation: "react.render",
      properties: {
        runtime: "react",
        source: "error-boundary"
      },
      severity: "fatal"
    });

    this.setState({ errorId });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="runtime-error-screen">
        <section className="runtime-error-panel" role="alert">
          <span className="runtime-error-kicker">Page Error</span>
          <h1>页面暂时无法继续显示</h1>
          <p>已保护当前浏览器中的本地数据。可以先刷新页面，或返回首页重新进入。</p>
          {this.state.errorId ? (
            <p className="runtime-error-id">错误编号：{this.state.errorId}</p>
          ) : null}
          <div className="runtime-error-actions">
            <button className="utility-button" type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <Link className="utility-button" href="/">
              返回首页
            </Link>
          </div>
        </section>
      </main>
    );
  }
}
