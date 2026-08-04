"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  EVENT_SESSION_TYPE_LABELS,
  EVENT_SESSION_TYPES,
} from "@/lib/ministryEvents";
import {
  addEventSessionAction,
  type CreateEventSessionFormState,
} from "@/server/actions/ministryEvents";
import styles from "./events.module.css";

const initialState: CreateEventSessionFormState = {
  success: false,
  message: "",
};

function AddSessionButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button primary" disabled={pending}>
      {pending ? "Adding session…" : "Add session"}
    </button>
  );
}

export function EventSessionForm({
  eventId,
  defaultDate,
  defaultLanguage,
}: {
  eventId: string;
  defaultDate: string;
  defaultLanguage: string;
}) {
  const [state, action] = useActionState(addEventSessionAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.createdSessionId, state.success]);

  return (
    <form ref={formRef} action={action} className={`${styles.sessionForm} stack-md`}>
      <input type="hidden" name="eventId" value={eventId} />
      <div className={styles.formGrid}>
        <div className={`${styles.fullField} stack-sm`}>
          <label htmlFor="session-title">Session title</label>
          <input id="session-title" name="title" required placeholder="Day 1 evening message" />
          {state.fieldErrors?.title ? <p className="field-error">{state.fieldErrors.title}</p> : null}
        </div>
        <div className="stack-sm">
          <label htmlFor="session-type">Session type</label>
          <select id="session-type" name="sessionType" defaultValue="PREACHING">
            {EVENT_SESSION_TYPES.map((type) => (
              <option key={type} value={type}>{EVENT_SESSION_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
        <div className="stack-sm">
          <label htmlFor="session-speaker">Speaker <span className="field-optional">Optional</span></label>
          <input id="session-speaker" name="speakerName" placeholder="Pastor Jane Doe" />
          {state.fieldErrors?.speakerName ? <p className="field-error">{state.fieldErrors.speakerName}</p> : null}
        </div>
        <div className="stack-sm">
          <label htmlFor="session-date">Date</label>
          <input id="session-date" name="sessionDate" type="date" required defaultValue={defaultDate} />
          {state.fieldErrors?.sessionDate ? <p className="field-error">{state.fieldErrors.sessionDate}</p> : null}
        </div>
        <div className={styles.timeFields}>
          <div className="stack-sm">
            <label htmlFor="session-start">Starts</label>
            <input id="session-start" name="startTime" type="time" required defaultValue="18:00" />
            {state.fieldErrors?.startTime ? <p className="field-error">{state.fieldErrors.startTime}</p> : null}
          </div>
          <div className="stack-sm">
            <label htmlFor="session-end">Ends <span className="field-optional">Optional</span></label>
            <input id="session-end" name="endTime" type="time" />
            {state.fieldErrors?.endTime ? <p className="field-error">{state.fieldErrors.endTime}</p> : null}
          </div>
        </div>
        <div className="stack-sm">
          <label htmlFor="session-language">Language</label>
          <input id="session-language" name="language" defaultValue={defaultLanguage} />
        </div>
        <div className="stack-sm">
          <label htmlFor="session-priority">Turnaround priority</label>
          <select id="session-priority" name="priority" defaultValue="50">
            <option value="80">Same-day priority</option>
            <option value="50">Standard</option>
            <option value="20">Archive / later</option>
          </select>
        </div>
        <div className={`${styles.fullField} stack-sm`}>
          <label htmlFor="session-notes">Team notes <span className="field-optional">Optional</span></label>
          <textarea id="session-notes" name="notes" rows={2} placeholder="Expected theme, handoff details, or recording notes." />
        </div>
      </div>

      {state.message ? (
        <p className={state.success ? "success-banner" : "error-banner"} role="status">{state.message}</p>
      ) : null}

      <div className={styles.formActions}>
        <AddSessionButton />
        <p className="muted small">Add the recording now or return after the session finishes.</p>
      </div>
    </form>
  );
}
