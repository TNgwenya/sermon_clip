"use client";

import { useState } from "react";

type CopyCaptionButtonProps = {
  label: string;
  text: string;
};

export function CopyCaptionButton({ label, text }: CopyCaptionButtonProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyCaption() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable.");
      }

      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2600);
    }
  }

  return (
    <button type="button" className="button secondary" onClick={copyCaption} aria-live="polite">
      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed · Try again" : label}
    </button>
  );
}
