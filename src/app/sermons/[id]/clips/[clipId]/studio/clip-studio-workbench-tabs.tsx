"use client";

import { type ReactNode, useState } from "react";

type StudioTabId = "edit" | "format" | "branding" | "evidence";

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
  evidence: ReactNode;
};

export function ClipStudioWorkbenchTabs({
  edit,
  format,
  branding,
  evidence,
}: ClipStudioWorkbenchTabsProps) {
  const [activeTab, setActiveTab] = useState<StudioTabId>("edit");

  const tabs: StudioTab[] = [
    { id: "edit", label: "Edit", eyebrow: "Timing and captions", content: edit },
    { id: "format", label: "Output", eyebrow: "Format and downloads", content: format },
    { id: "branding", label: "Branding", eyebrow: "Church identity", content: branding },
    { id: "evidence", label: "Evidence", eyebrow: "AI reasoning", content: evidence },
  ];

  return (
    <section className="clip-studio-workbench stack-md">
      <div className="clip-studio-workbench-head">
        <div>
          <p className="kicker">Workbench</p>
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
