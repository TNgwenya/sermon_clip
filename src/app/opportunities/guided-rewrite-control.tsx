"use client";

import {
  GUIDED_REWRITE_VARIANT_LABELS,
  GUIDED_REWRITE_VARIANTS,
  type GuidedRewriteVariant,
} from "@/lib/contentGuidedRewriteOptions";
import type { ContentOpportunityType } from "@/server/ai/contentOpportunitySchema";

type Props = {
  opportunityId: string;
  opportunityType: ContentOpportunityType;
  selectedVariant: GuidedRewriteVariant;
  disabled: boolean;
  pending: boolean;
  notice?: string;
  onVariantChange: (variant: GuidedRewriteVariant) => void;
  onRequest: () => void;
};

export function GuidedRewriteControl({
  opportunityId,
  opportunityType,
  selectedVariant,
  disabled,
  pending,
  notice,
  onVariantChange,
  onRequest,
}: Props) {
  if (opportunityType === "QUOTE_GRAPHIC" || opportunityType === "SCRIPTURE_GRAPHIC") {
    return (
      <div className="opportunity-guided-rewrite-protected" role="note">
        <strong>Exact wording protected</strong>
        <span>
          Guided rewrites are off for {opportunityType === "QUOTE_GRAPHIC" ? "pastor quotes" : "Scripture"}. Edit the wording manually and complete its evidence check before approval.
        </span>
      </div>
    );
  }

  return (
    <details className="opportunity-guided-rewrite">
      <summary>Try a guided rewrite</summary>
      <div className="stack-sm">
        <p className="muted small">
          Create one suggestion from this draft and its stored sermon evidence. It never approves or publishes content.
        </p>
        <div className="opportunity-guided-rewrite-controls">
          <label className="stack-sm" htmlFor={`guided-rewrite-variant-${opportunityId}`}>
            Direction
            <select
              id={`guided-rewrite-variant-${opportunityId}`}
              value={selectedVariant}
              onChange={(event) => onVariantChange(event.target.value as GuidedRewriteVariant)}
              disabled={disabled}
            >
              {GUIDED_REWRITE_VARIANTS.map((variant) => (
                <option key={variant} value={variant}>{GUIDED_REWRITE_VARIANT_LABELS[variant]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={onRequest}
          >
            {pending ? "Creating suggestion…" : "Create review suggestion"}
          </button>
        </div>
        {notice ? (
          <p className="opportunity-guided-rewrite-result small" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
