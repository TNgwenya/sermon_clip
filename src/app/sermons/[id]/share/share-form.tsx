"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  savePublicSermonPageAction,
  type PublicSermonActionState,
} from "@/app/sermons/[id]/share/actions";
import styles from "@/app/sermons/[id]/share/share.module.css";

const initialState: PublicSermonActionState = {
  success: false,
  message: "",
};

function SubmitButton({
  intent,
  children,
  className,
}: {
  intent: "SAVE" | "PUBLISH" | "ARCHIVE";
  children: React.ReactNode;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      className={className}
      disabled={pending}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

export function PublicSermonShareForm({
  sermonId,
  initial,
}: {
  sermonId: string;
  initial: {
    slug: string;
    title: string;
    summary: string;
    primaryCtaLabel: string;
    primaryCtaUrl: string;
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  };
}) {
  const action = savePublicSermonPageAction.bind(null, sermonId);
  const [state, formAction] = useActionState(action, initialState);
  const publicSlug = state.publishedSlug ?? (initial.status === "PUBLISHED" ? initial.slug : null);

  return (
    <form action={formAction} className={styles.form}>
      <section className={styles.formCard} aria-labelledby="public-page-details">
        <div className={styles.sectionHeading}>
          <div>
            <span>Public identity</span>
            <h2 id="public-page-details">Page details</h2>
          </div>
          <span className={`${styles.status} ${styles[initial.status.toLowerCase()]}`}>
            {initial.status.toLowerCase()}
          </span>
        </div>

        <label className={styles.field}>
          <span>Public page title</span>
          <input
            name="title"
            defaultValue={initial.title}
            required
            maxLength={140}
            aria-invalid={Boolean(state.fieldErrors?.title)}
            aria-describedby={state.fieldErrors?.title ? "public-title-error" : undefined}
          />
          {state.fieldErrors?.title ? <small id="public-title-error" className={styles.fieldError}>{state.fieldErrors.title}</small> : null}
        </label>

        <label className={styles.field}>
          <span>Public address</span>
          <div className={styles.slugField}>
            <span>/s/</span>
            <input
              name="slug"
              defaultValue={initial.slug}
              required
              minLength={3}
              maxLength={80}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              autoCapitalize="none"
              autoCorrect="off"
              aria-invalid={Boolean(state.fieldErrors?.slug)}
              aria-describedby={state.fieldErrors?.slug ? "public-slug-error" : "public-slug-help"}
            />
          </div>
          <small id="public-slug-help">Lowercase letters, numbers, and hyphens. Changing a live slug changes its public URL.</small>
          {state.fieldErrors?.slug ? <small id="public-slug-error" className={styles.fieldError}>{state.fieldErrors.slug}</small> : null}
        </label>

        <label className={styles.field}>
          <span>Welcome summary</span>
          <textarea
            name="summary"
            defaultValue={initial.summary}
            rows={5}
            maxLength={1_000}
            placeholder="A short, visitor-friendly introduction to this message."
            aria-invalid={Boolean(state.fieldErrors?.summary)}
          />
          <small>Only this summary, sermon details, and approved publishing content can appear publicly.</small>
          {state.fieldErrors?.summary ? <small className={styles.fieldError}>{state.fieldErrors.summary}</small> : null}
        </label>
      </section>

      <section className={styles.formCard} aria-labelledby="public-page-cta">
        <div className={styles.sectionHeading}>
          <div>
            <span>Meaningful next step</span>
            <h2 id="public-page-cta">Primary call to action</h2>
          </div>
          <span className={styles.optional}>Optional</span>
        </div>
        <div className={styles.twoColumns}>
          <label className={styles.field}>
            <span>Button label</span>
            <input
              name="primaryCtaLabel"
              defaultValue={initial.primaryCtaLabel}
              maxLength={60}
              placeholder="Plan your visit"
              aria-invalid={Boolean(state.fieldErrors?.primaryCtaLabel)}
            />
            {state.fieldErrors?.primaryCtaLabel ? <small className={styles.fieldError}>{state.fieldErrors.primaryCtaLabel}</small> : null}
          </label>
          <label className={styles.field}>
            <span>HTTPS destination</span>
            <input
              name="primaryCtaUrl"
              type="url"
              inputMode="url"
              defaultValue={initial.primaryCtaUrl}
              maxLength={2_000}
              placeholder="https://yourchurch.org/visit"
              aria-invalid={Boolean(state.fieldErrors?.primaryCtaUrl)}
            />
            {state.fieldErrors?.primaryCtaUrl ? <small className={styles.fieldError}>{state.fieldErrors.primaryCtaUrl}</small> : null}
          </label>
        </div>
        <p className={styles.privacyNote}>
          CTA clicks are stored only as an aggregate ministry outcome. SermonClip does not attach an IP address, browser fingerprint, or visitor identity.
        </p>
      </section>

      <div className={styles.actions}>
        <SubmitButton intent="SAVE" className="button secondary">Save draft</SubmitButton>
        <SubmitButton intent="PUBLISH" className="button primary">
          {initial.status === "PUBLISHED" ? "Update live page" : "Publish page"}
        </SubmitButton>
        {initial.status === "PUBLISHED" ? (
          <SubmitButton intent="ARCHIVE" className="button tertiary">Archive page</SubmitButton>
        ) : null}
        {publicSlug ? (
          <Link href={`/s/${publicSlug}`} className="button tertiary" target="_blank">
            View public page
          </Link>
        ) : null}
      </div>

      {state.message ? (
        <p className={state.success ? styles.success : styles.error} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
