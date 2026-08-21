import type { CustomerValueMilestone, CustomerValueState } from "@/lib/orchestrationProgress";

const stateLabels: Record<CustomerValueState, string> = {
  waiting: "Waiting",
  active: "In progress",
  ready: "Ready",
  degraded: "Partly ready",
  attention: "Needs attention",
  "not-requested": "On demand",
};

function visualState(state: CustomerValueState): "done" | "active" | "failed" | "pending" {
  if (state === "ready") return "done";
  if (state === "active") return "active";
  if (state === "attention") return "failed";
  return "pending";
}

export function ProgressMilestones({ milestones }: { milestones: CustomerValueMilestone[] }) {
  return (
    <section id="customer-value-progress" className="panel stack-md" aria-labelledby="customer-value-progress-title">
      <div>
        <p className="kicker">What will be ready first</p>
        <h2 id="customer-value-progress-title">Your sermon content progress</h2>
        <p className="muted">
          Ranked suggestions appear first, followed by one branded clip and then the top review clips.
          Optional lower-ranked previews and Content Week stay separate so they do not delay pastor review.
        </p>
      </div>
      <div className="processing-step-grid" role="list" aria-label="Content preparation milestones">
        {milestones.map((milestone) => {
          const presentation = visualState(milestone.state);
          return (
            <article
              key={milestone.key}
              className={`processing-step-card ${presentation}`}
              role="listitem"
              aria-label={`${milestone.label}: ${stateLabels[milestone.state]}`}
            >
              <span
                aria-hidden="true"
                className={`status-dot ${presentation === "done" ? "done" : "pending"} ${presentation === "failed" ? "failed" : ""} ${presentation === "active" ? "running" : ""}`}
              />
              <strong>{milestone.label}</strong>
              <span className="muted small">{stateLabels[milestone.state]}</span>
              <span className="muted small">{milestone.detail}</span>
            </article>
          );
        })}
      </div>
      <p className="muted small">
        Progress is based on completed job and media evidence, not a timer. Review, approval, export, and publishing remain explicit team decisions.
      </p>
    </section>
  );
}
