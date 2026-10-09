"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/use-i18n";

export interface ConfirmDialogOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface PendingDialog {
  id: number;
  kind: "confirm" | "alert";
  options: ConfirmDialogOptions;
  resolve: (confirmed: boolean) => void;
}

let queue: PendingDialog[] = [];
let idleWaiters: Array<() => void> = [];
let mountedHosts = 0;
let nextDialogId = 1;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
  if (queue.length === 0 && idleWaiters.length > 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getCurrentDialog(): PendingDialog | null {
  return queue[0] ?? null;
}

function getServerDialog(): PendingDialog | null {
  return null;
}

function toOptions(input: ConfirmDialogOptions | string): ConfirmDialogOptions {
  return typeof input === "string" ? { message: input } : input;
}

function enqueueDialog(kind: PendingDialog["kind"], options: ConfirmDialogOptions): Promise<boolean> {
  if (mountedHosts === 0) {
    // No host mounted (should not happen inside AppRuntimeShell): keep the old blocking behaviour.
    if (kind === "confirm") {
      return Promise.resolve(window.confirm(options.message));
    }

    window.alert(options.message);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    queue = [...queue, { id: nextDialogId++, kind, options, resolve }];
    emitChange();
  });
}

function settleDialog(id: number, confirmed: boolean) {
  const dialog = queue.find((item) => item.id === id);
  if (!dialog) {
    return;
  }

  queue = queue.filter((item) => item.id !== id);
  dialog.resolve(confirmed);
  emitChange();
}

function cancelAllDialogs() {
  if (queue.length === 0) {
    return;
  }

  const pending = queue;
  queue = [];
  pending.forEach((dialog) => dialog.resolve(false));
  emitChange();
}

/** In-page replacement for window.confirm; resolves true only when the user confirms. */
export function requestConfirm(input: ConfirmDialogOptions | string): Promise<boolean> {
  return enqueueDialog("confirm", toOptions(input));
}

/** In-page replacement for window.alert; resolves once the user dismisses it. */
export async function showAlert(input: ConfirmDialogOptions | string): Promise<void> {
  await enqueueDialog("alert", toOptions(input));
}

/** True while a confirm/alert is waiting for the user; background work should not change the document then. */
export function hasPendingDialog(): boolean {
  return queue.length > 0;
}

/** Resolves once no confirm/alert is open. Callers should re-check their state afterwards. */
export function waitForDialogsClosed(): Promise<void> {
  if (queue.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    idleWaiters = [...idleWaiters, resolve];
  });
}

export function ConfirmDialogHost() {
  const current = useSyncExternalStore(subscribe, getCurrentDialog, getServerDialog);
  const pathname = usePathname();

  useEffect(() => {
    mountedHosts += 1;
    return () => {
      mountedHosts -= 1;
      if (mountedHosts === 0) {
        cancelAllDialogs();
      }
    };
  }, []);

  // A dialog belongs to the page that opened it: leaving the page (e.g. browser Back) cancels it,
  // so a stale handler can never run its action on a page the user already left.
  useEffect(() => cancelAllDialogs, [pathname]);

  if (!current) {
    return null;
  }

  return <ConfirmDialogView key={current.id} dialog={current} />;
}

function ConfirmDialogView({ dialog }: { dialog: PendingDialog }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  const { options } = dialog;
  const isConfirm = dialog.kind === "confirm";

  useEffect(() => {
    const element = dialogRef.current;
    if (!element || element.open) {
      return;
    }

    // showModal() focuses the first button: Cancel for confirms, so Enter never confirms by accident.
    if (typeof element.showModal === "function") {
      element.showModal();
    } else {
      element.setAttribute("open", "");
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      role={isConfirm ? "alertdialog" : "dialog"}
      aria-labelledby={options.title ? titleId : undefined}
      aria-describedby={messageId}
      aria-label={options.title ? undefined : options.message}
      onCancel={(event) => {
        event.preventDefault();
        settleDialog(dialog.id, false);
      }}
    >
      <div className="editor-card confirm-dialog-card">
        <div className="editor-body">
          {options.title ? <h2 className="editor-title" id={titleId}>{options.title}</h2> : null}
          <p className="confirm-dialog-message" id={messageId}>{options.message}</p>
        </div>
        <div className="editor-footer confirm-dialog-actions">
          {isConfirm ? (
            <button className="utility-button" type="button" onClick={() => settleDialog(dialog.id, false)}>
              {options.cancelLabel ?? t("common.cancel")}
            </button>
          ) : null}
          <button
            className={options.tone === "danger" ? "danger-button" : "utility-button"}
            type="button"
            onClick={() => settleDialog(dialog.id, true)}
          >
            {options.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
