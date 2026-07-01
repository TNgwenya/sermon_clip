"use client";

import { type ReactNode, useState } from "react";

type StudioTabId = "edit" | "format" | "branding" | "post" | "evidence" | "advanced";

type StudioTab = {
  id: StudioTabId;
  label: string;
  eyebrow: string;
  content: ReactNode;
};

type ClipStudioWorkbenchTabsProps = {
  edit: ReactNode;
  format: ReactNode;
  branding: ReactNode;
  post: ReactNode;
  evidence: ReactNode;
  advanced: ReactNode;
};

export function ClipStudioWorkbenchTabs({
  edit,
  format,
  branding,
  post,
  evidence,
  advanced,
}: ClipStudioWorkbenchTabsProps) {
  const [activeTab, setActiveTab] = useState<StudioTabId>("edit");

  const tabs: StudioTab[] = [
    { id: "edit", label: "Clip", eyebrow: "Clip tools", content: edit },
    { id: "format", label: "Framing", eyebrow: "Format and crop", content: format },
    { id: "branding", label: "Brand", eyebrow: "Church identity", content: branding },
    { id: "post", label: "Post", eyebrow: "Prepared media state", content: post },
    { id: "evidence", label: "Why", eyebrow: "Why this clip works", content: evidence },
    { id: "advanced", label: "Advanced", eyebrow: "Diagnostics", content: advanced },
  ];

  return (
    <section className="clip-studio-workbench stack-md">
      <div className="clip-studio-workbench-head">
        <div>
          <p className="kicker">Tool rail</p>
          <h2>{tabs.find((tab) => tab.id === activeTab)?.eyebrow}</h2>
        </div>
        <div className="clip-studio-tabs" role="tablist" aria-label="Clip Studio tools">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "clip-studio-tab is-active" : "clip-studio-tab"}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {tabs.map((tab) => (
        <div key={tab.id} className="clip-studio-tab-panel" role="tabpanel" hidden={activeTab !== tab.id}>
          {tab.content}
        </div>
      ))}
    </section>
  );
}
