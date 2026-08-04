"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  MINISTRY_EVENT_TYPE_LABELS,
  MINISTRY_EVENT_TYPES,
} from "@/lib/ministryEvents";
import {
  createMinistryEventAction,
  type CreateMinistryEventFormState,
} from "@/server/actions/ministryEvents";
import styles from "./events.module.css";

const initialState: CreateMinistryEventFormState = {
  success: false,
  message: "",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button primary" disabled={pending}>
      {pending ? "Creating event…" : "Create event programme"}
    </button>
  );
}

export function EventForm({
  defaultStartDate,
  defaultTimezone,
}: {
  defaultStartDate: string;
  defaultTimezone: string;
}) {
  const [state, action] = useActionState(createMinistryEventAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.success && state.createdEventId) {
      router.replace(`/events/${state.createdEventId}`);
    }
  }, [router, state.createdEventId, state.success]);

  return (
    <form action={action} className={`${styles.eventForm} card stack-lg`}>
      <section className="stack-md">
        <div className={styles.formHeading}>
          <span>01</span>
          <div>
            <p className="kicker">Event identity</p>
            <h2>Name the shared conference workspace</h2>
          </div>
        </div>

        <div className={styles.formGrid}>
          <div className={`${styles.fullField} stack-sm`}>
            <label htmlFor="name">Event name</label>
            <input id="name" name="name" required placeholder="Kingdom Conference 2026" />
            {state.fieldErrors?.name ? <p className="field-error">{state.fieldErrors.name}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="eventType">Event type</label>
            <select id="eventType" name="eventType" defaultValue="CONFERENCE">
              {MINISTRY_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>{MINISTRY_EVENT_TYPE_LABELS[type]}</option>
              ))}
            </select>
            {state.fieldErrors?.eventType ? <p className="field-error">{state.fieldErrors.eventType}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="theme">Theme <span className="field-optional">Optional</span></label>
            <input id="theme" name="theme" placeholder="Lifted Eyes" />
            {state.fieldErrors?.theme ? <p className="field-error">{state.fieldErrors.theme}</p> : null}
          </div>
          <div className={`${styles.fullField} stack-sm`}>
            <label htmlFor="description">Event description <span className="field-optional">Optional</span></label>
            <textarea id="description" name="description" rows={3} placeholder="A short internal description for the media and pastoral teams." />
            {state.fieldErrors?.description ? <p className="field-error">{state.fieldErrors.description}</p> : null}
          </div>
        </div>
      </section>

      <section className="stack-md">
        <div className={styles.formHeading}>
          <span>02</span>
          <div>
            <p className="kicker">Programme dates</p>
            <h2>Set the event window</h2>
          </div>
        </div>
        <div className={styles.formGrid}>
          <div className="stack-sm">
            <label htmlFor="startDate">Starts</label>
            <input id="startDate" name="startDate" type="date" required defaultValue={defaultStartDate} />
            {state.fieldErrors?.startDate ? <p className="field-error">{state.fieldErrors.startDate}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="endDate">Ends</label>
            <input id="endDate" name="endDate" type="date" required defaultValue={defaultStartDate} />
            {state.fieldErrors?.endDate ? <p className="field-error">{state.fieldErrors.endDate}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="timezone">Timezone</label>
            <input id="timezone" name="timezone" required defaultValue={defaultTimezone} placeholder="Africa/Johannesburg" />
            {state.fieldErrors?.timezone ? <p className="field-error">{state.fieldErrors.timezone}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="venue">Venue <span className="field-optional">Optional</span></label>
            <input id="venue" name="venue" placeholder="Main auditorium" />
            {state.fieldErrors?.venue ? <p className="field-error">{state.fieldErrors.venue}</p> : null}
          </div>
        </div>
      </section>

      <details className={styles.brandDetails}>
        <summary>Optional conference colours</summary>
        <div className={styles.formGrid}>
          <div className="stack-sm">
            <label htmlFor="primaryBrandColor">Primary colour</label>
            <input id="primaryBrandColor" name="primaryBrandColor" placeholder="#2A6F4E" />
            {state.fieldErrors?.primaryBrandColor ? <p className="field-error">{state.fieldErrors.primaryBrandColor}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="secondaryBrandColor">Secondary colour</label>
            <input id="secondaryBrandColor" name="secondaryBrandColor" placeholder="#E2B45E" />
            {state.fieldErrors?.secondaryBrandColor ? <p className="field-error">{state.fieldErrors.secondaryBrandColor}</p> : null}
          </div>
        </div>
      </details>

      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"} role="status">{state.message}</p>
      ) : null}

      <div className={styles.formActions}>
        <SubmitButton />
        <p className="muted small">You can add speakers and session recordings after creating the event.</p>
      </div>
    </form>
  );
}
