"use client";

import { useState } from "react";

type CopyCaptionButtonProps = {
  label: string;
  text: string;
};

export function CopyCaptionButton({ label, text }: CopyCaptionButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyCaption() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button type="button" className="button secondary" onClick={copyCaption}>
      {copied ? "Copied" : label}
    </button>
  );
}
