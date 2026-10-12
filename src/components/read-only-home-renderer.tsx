"use client";

import type { ReactNode } from "react";
import { Component } from "react";
import { SiteIcon } from "@/components/site-icon";
import { ReadOnlyThemeStyleBridge } from "@/components/read-only-theme-style-bridge";
import type {
  ReadOnlyHomeDocument,
  ReadOnlyHomeGroup,
  ReadOnlyHomeSite,
  ReadOnlyHomeTheme
} from "@/domain/public-home-document";

export type {
  ReadOnlyHomeDocument,
  ReadOnlyHomeGroup,
  ReadOnlyHomeSite,
  ReadOnlyHomeTheme
} from "@/domain/public-home-document";

export interface ReadOnlyHomeCopy {
  emptyLabel: string;
  unavailableLabel: string;
}

export type ReadOnlyHomeRendererStatus = "loading" | "ready" | "empty" | "invalid";

interface ReadOnlyHomeRendererProps {
  document: ReadOnlyHomeDocument | null;
  status: ReadOnlyHomeRendererStatus;
  copy: ReadOnlyHomeCopy;
  colorScheme?: "system" | "light" | "dark";
  /** Embedded previews inherit the host page theme and must not rewrite its root variables or images. */
  applyThemeToDocument?: boolean;
}

/**
 * A data-source-agnostic home presentation. It deliberately contains no editing,
 * account, sync, analytics, storage, or local persistence behaviour.
 */
export function ReadOnlyHomeRenderer({
  document: documentValue,
  status,
  copy,
  colorScheme = "system",
  applyThemeToDocument = true
}: ReadOnlyHomeRendererProps) {
  if (status === "loading") {
    return <ReadOnlyHomeFallback label={copy.emptyLabel} loading />;
  }

  if (status !== "ready" || !isRenderableDocument(documentValue)) {
    return <ReadOnlyHomeFallback label={status === "empty" ? copy.emptyLabel : copy.unavailableLabel} />;
  }

  const groups = [...documentValue.groups]
    .filter(isRenderableGroup)
    .sort((left, right) => left.order - right.order);
  if (groups.length === 0) {
    return <ReadOnlyHomeFallback label={copy.emptyLabel} />;
  }

  return (
    <>
      {applyThemeToDocument ? <ReadOnlyThemeStyleBridge theme={documentValue.theme} colorScheme={colorScheme} /> : null}
      <main className="page read-only-home" aria-label={documentValue.documentTitle}>
        <header className="masthead read-only-masthead">
          <div className="home-title-block">
            <h1 className="home-title-display">{documentValue.documentTitle}</h1>
          </div>
        </header>
        <section className="sections read-only-sections">
          {groups.map((group) => (
            <article className="section read-only-section" key={group.id}>
              <div className="section-meta">
                <h2 className="section-title">{group.title}</h2>
                <span className="section-count">{group.sites.length}</span>
              </div>
              <div className="links read-only-links">
                {[...group.sites].filter(isRenderableSite).sort((left, right) => left.order - right.order).map((site) => (
                  <ReadOnlySiteTile key={site.id} site={site} />
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}

interface ReadOnlyHomeFallbackProps {
  label: string;
  loading?: boolean;
}

function ReadOnlyHomeFallback({ label, loading = false }: ReadOnlyHomeFallbackProps) {
  return (
    <main className="page read-only-home">
      <p className={`empty-state${loading ? " is-loading" : ""}`} aria-live="polite">{label}</p>
    </main>
  );
}

function ReadOnlySiteTile({ site }: { site: ReadOnlyHomeSite }) {
  const href = toSafeExternalHref(site.url);
  const content = <><SiteIcon site={site} /><span className="site-name">{site.name}</span></>;

  return (
    <div className="site-tile read-only-site-tile">
      {href ? (
        <a className="site-link" href={href} target="_blank" rel="noopener noreferrer">{content}</a>
      ) : (
        <div className="site-link" aria-disabled="true">{content}</div>
      )}
    </div>
  );
}

function isRenderableDocument(value: ReadOnlyHomeDocument | null): value is ReadOnlyHomeDocument {
  return Boolean(
    value
    && typeof value.documentTitle === "string"
    && isRenderableTheme(value.theme)
    && Array.isArray(value.groups)
  );
}

function isRenderableTheme(value: ReadOnlyHomeTheme): value is ReadOnlyHomeTheme {
  return Boolean(value && typeof value.presetId === "string" && typeof value.accent === "string");
}

function isRenderableGroup(value: ReadOnlyHomeGroup): value is ReadOnlyHomeGroup {
  return Boolean(value && typeof value.id === "string" && typeof value.title === "string" && Array.isArray(value.sites));
}

function isRenderableSite(value: ReadOnlyHomeSite): value is ReadOnlyHomeSite {
  return Boolean(value && typeof value.id === "string" && typeof value.name === "string" && typeof value.url === "string" && typeof value.mark === "string");
}

function toSafeExternalHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

interface ReadOnlyHomeRendererBoundaryProps {
  children: ReactNode;
  unavailableLabel: string;
}

interface ReadOnlyHomeRendererBoundaryState {
  failed: boolean;
}

/** A non-reporting boundary: public document data and URLs must not enter telemetry. */
export class ReadOnlyHomeRendererBoundary extends Component<
  ReadOnlyHomeRendererBoundaryProps,
  ReadOnlyHomeRendererBoundaryState
> {
  state: ReadOnlyHomeRendererBoundaryState = { failed: false };

  static getDerivedStateFromError(): ReadOnlyHomeRendererBoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    // Intentionally do not report: the renderer can receive public user content.
  }

  render() {
    if (this.state.failed) {
      return <ReadOnlyHomeFallback label={this.props.unavailableLabel} />;
    }

    return this.props.children;
  }
}
