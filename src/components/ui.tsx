import Link from "next/link";

type ActionLink = {
  label: string;
  href: string;
  variant?: "primary" | "secondary" | "tertiary";
};
import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ActionLink[];
  meta?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="page-header card stack-md">
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
};

export function SectionCard({ title, description, children, className }: SectionCardProps) {
  return (
    <section className={`card section-card stack-md${className ? ` ${className}` : ""}`}>
      <div className="section-card-heading stack-sm">
        <h2>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
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
  title: string;
  description: string;
  action?: ActionLink;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-copy stack-sm">
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
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`pill tone-${tone}`}>{children}</span>;
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
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
  size?: "sm" | "md";
};

export function Chip({ children, tone = "neutral", size = "md" }: ChipProps) {
  return <span className={`chip tone-${tone} chip-${size}`}>{children}</span>;
}

export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="action-bar">{children}</div>;
}

export function FilterPanel({ children }: { children: React.ReactNode }) {
  return <section className="card filter-panel stack-sm">{children}</section>;
}

export function DataListItem({ children }: { children: ReactNode }) {
  return <li className="data-list-item">{children}</li>;
}
