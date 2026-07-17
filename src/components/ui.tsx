import Link from "next/link";
import type { ReactNode } from "react";

export type ActionLink = {
  label: string;
  href: string;
  variant?: "primary" | "secondary" | "tertiary";
};

export type UiTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ActionLink[];
  meta?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={`page-header card stack-md${className ? ` ${className}` : ""}`}>
      <div className="stack-sm">
        {eyebrow ? <p className="kicker">{eyebrow}</p> : null}
        <div className="page-header-title-row">
          <h1>{title}</h1>
          {meta ? <div className="page-header-meta">{meta}</div> : null}
        </div>
        {description ? <p className="muted page-header-description">{description}</p> : null}
      </div>

      {actions && actions.length > 0 ? (
        <div className="actions-row page-header-actions">
          {actions.map((action) => (
            <Link key={`${action.href}-${action.label}`} href={action.href} className={`button ${action.variant ?? "secondary"}`}>
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </header>
  );
}

type SectionCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ActionLink;
};

export function SectionCard({ title, description, children, className, headerAction }: SectionCardProps) {
  return (
    <section className={`card section-card stack-md${className ? ` ${className}` : ""}`}>
      <div className="section-card-heading-row">
        <div className="section-card-heading stack-sm">
          <h2>{title}</h2>
          {description ? <p className="muted">{description}</p> : null}
        </div>
        {headerAction ? (
          <Link href={headerAction.href} className={`section-card-action button ${headerAction.variant ?? "tertiary"}`}>
            {headerAction.label}
            <span aria-hidden="true">&#8599;</span>
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

type StatCardProps = {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
};

export function StatCard({ label, value, detail, tone = "neutral" }: StatCardProps) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <p className="muted small stat-card-label">{label}</p>
      <p className="stat-card-value">{value}</p>
      {detail ? <p className="muted small stat-card-detail">{detail}</p> : null}
    </article>
  );
}

type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ActionLink;
  className?: string;
  icon?: ReactNode;
};

export function EmptyState({ eyebrow, title, description, action, className, icon }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ""}`}>
      {icon ? <span className="empty-state-icon" aria-hidden="true">{icon}</span> : null}
      <div className="empty-state-copy stack-sm">
        {eyebrow ? <p className="kicker">{eyebrow}</p> : null}
        <p className="empty-state-title">{title}</p>
        <p className="muted">{description}</p>
      </div>
      {action ? (
        <Link href={action.href} className={`button ${action.variant ?? "secondary"}`}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: UiTone;
  className?: string;
};

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return <span className={`pill tone-${tone}${className ? ` ${className}` : ""}`}>{children}</span>;
}

type ConfidenceBadgeProps = {
  score: number | null;
};

export function ConfidenceBadge({ score }: ConfidenceBadgeProps) {
  if (score === null) {
    return <StatusBadge tone="neutral">Confidence unknown</StatusBadge>;
  }

  const percent = Math.round(score * 100);
  const tone = score >= 0.8 ? "success" : score >= 0.55 ? "warning" : "danger";
  const label = score >= 0.8 ? "High confidence" : score >= 0.55 ? "Medium confidence" : "Low confidence";

  return <StatusBadge tone={tone}>{label} · {percent}%</StatusBadge>;
}

type ChipProps = {
  children: React.ReactNode;
  tone?: UiTone;
  size?: "sm" | "md";
  className?: string;
};

export function Chip({ children, tone = "neutral", size = "md", className }: ChipProps) {
  return <span className={`chip tone-${tone} chip-${size}${className ? ` ${className}` : ""}`}>{children}</span>;
}

export function ActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`action-bar${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function FilterPanel({ children }: { children: React.ReactNode }) {
  return <section className="card filter-panel stack-sm">{children}</section>;
}

export function DataListItem({ children }: { children: ReactNode }) {
  return <li className="data-list-item">{children}</li>;
}

type NoticeProps = {
  children: ReactNode;
  title?: string;
  tone?: Exclude<UiTone, "accent">;
  className?: string;
  live?: boolean;
};

export function Notice({ children, title, tone = "neutral", className, live = false }: NoticeProps) {
  return (
    <div
      className={`notice tone-${tone}${className ? ` ${className}` : ""}`}
      role={tone === "danger" ? "alert" : live ? "status" : undefined}
      aria-live={live && tone !== "danger" ? "polite" : undefined}
    >
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export type WorkflowStepState = "complete" | "current" | "upcoming" | "attention";

type WorkflowProgressProps = {
  steps: Array<{ label: string; state: WorkflowStepState }>;
  label?: string;
  className?: string;
};

export function WorkflowProgress({ steps, label = "Sermon clip workflow", className }: WorkflowProgressProps) {
  return (
    <ol className={`workflow-progress${className ? ` ${className}` : ""}`} aria-label={label}>
      {steps.map((step, index) => (
        <li className={`workflow-progress-step is-${step.state}`} key={`${step.label}-${index}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="workflow-progress-marker" aria-hidden="true">{step.state === "complete" ? "✓" : index + 1}</span>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
