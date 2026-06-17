"use client";

import {
  HOME_TEMPLATES,
  type HomeTemplate,
  type HomeTemplateId,
  summarizeHomeTemplate
} from "@/domain/home-template";

interface TemplateLibraryPanelProps {
  actionLabel?: string;
  className?: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  selectedTemplateId?: HomeTemplateId;
  title?: string;
  onApply: (template: HomeTemplate) => void;
}

export function TemplateLibraryPanel({
  actionLabel = "使用模板",
  className = "",
  description = "选择一个接近的起点，之后可以自由删除、拖拽、重命名或继续添加网站。",
  disabled = false,
  disabledReason,
  selectedTemplateId,
  title = "模板库",
  onApply
}: TemplateLibraryPanelProps) {
  return (
    <section className={`template-library ${className}`.trim()} aria-label={title}>
      <div className="template-library-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className="template-grid">
        {HOME_TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            actionLabel={actionLabel}
            disabled={disabled}
            disabledReason={disabledReason}
            selected={selectedTemplateId === template.id}
            template={template}
            onApply={onApply}
          />
        ))}
      </div>
    </section>
  );
}

function TemplateCard({
  actionLabel,
  disabled,
  disabledReason,
  selected,
  template,
  onApply
}: {
  actionLabel: string;
  disabled: boolean;
  disabledReason?: string;
  selected: boolean;
  template: HomeTemplate;
  onApply: (template: HomeTemplate) => void;
}) {
  const summary = summarizeHomeTemplate(template);
  const metricText = `${summary.groupCount} 个分组 · ${summary.siteCount} 个网站`;
  const sampleText = summary.sampleSites.length > 0 ? summary.sampleSites.join(" / ") : "不预设网站";

  return (
    <article className={`template-card${selected ? " is-selected" : ""}`}>
      <div className="template-card-main">
        <div className="template-card-title-row">
          <span className="template-accent" style={{ backgroundColor: template.accent }} aria-hidden="true" />
          <h3>{template.name}</h3>
        </div>
        <p>{template.summary}</p>
      </div>
      <div className="template-card-meta">
        <span>{metricText}</span>
        <span>{sampleText}</span>
      </div>
      <button
        className="utility-button"
        type="button"
        disabled={disabled}
        title={disabled ? disabledReason : `从“${template.name}”创建首页`}
        onClick={() => onApply(template)}
      >
        {selected ? "已选择" : actionLabel}
      </button>
    </article>
  );
}
