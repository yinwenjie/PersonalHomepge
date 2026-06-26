"use client";

import { useEffect } from "react";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";

export function ErrorMonitoringInstaller() {
  useEffect(() => {
    function handleWindowError(event: ErrorEvent | Event) {
      const resourceInfo = getResourceErrorInfo(event);
      if (resourceInfo) {
        captureClientError(new Error(`${resourceInfo.resourceKind} resource failed to load`), {
          eventType: "resource_load_failed",
          operation: "resource.load",
          properties: {
            resourceKind: resourceInfo.resourceKind,
            resourceOriginKind: resourceInfo.resourceOriginKind,
            runtime: "browser",
            source: "window.error"
          },
          severity: "warning"
        });
        return;
      }

      const errorEvent = event as ErrorEvent;
      captureClientError(errorEvent.error ?? errorEvent.message ?? "Window error", {
        eventType: "window_error",
        operation: "window.error",
        properties: {
          runtime: "browser",
          source: "window.error"
        },
        severity: "error"
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      captureClientError(event.reason ?? "Unhandled promise rejection", {
        eventType: "unhandled_rejection",
        operation: "promise.unhandled_rejection",
        properties: {
          runtime: "browser",
          source: "unhandledrejection"
        },
        severity: "error"
      });
    }

    window.addEventListener("error", handleWindowError, true);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError, true);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

function getResourceErrorInfo(event: Event): { resourceKind: string; resourceOriginKind: string } | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const resourceKind = getResourceKind(target);
  if (!resourceKind) {
    return null;
  }

  return {
    resourceKind,
    resourceOriginKind: getResourceOriginKind(target)
  };
}

function getResourceKind(element: HTMLElement): string | null {
  if (element instanceof HTMLScriptElement) {
    return "script";
  }

  if (element instanceof HTMLLinkElement) {
    return element.rel === "stylesheet" ? "style" : "link";
  }

  if (element instanceof HTMLImageElement) {
    return "image";
  }

  if (element instanceof HTMLVideoElement) {
    return "video";
  }

  if (element instanceof HTMLAudioElement) {
    return "audio";
  }

  return null;
}

function getResourceOriginKind(element: HTMLElement): string {
  const source = readResourceSource(element);
  if (!source) {
    return "unknown";
  }

  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin ? "same-origin" : "cross-origin";
  } catch {
    return "unknown";
  }
}

function readResourceSource(element: HTMLElement): string {
  if (element instanceof HTMLScriptElement) {
    return element.src;
  }

  if (element instanceof HTMLLinkElement) {
    return element.href;
  }

  if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
    return element.currentSrc || element.src;
  }

  return "";
}
