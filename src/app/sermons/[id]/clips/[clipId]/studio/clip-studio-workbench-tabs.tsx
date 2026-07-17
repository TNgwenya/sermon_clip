"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";

type StudioTabId = "edit" | "format" | "branding" | "post" | "evidence";

type MobileStudioTaskId = "preview" | "transcript" | StudioTabId;

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
  advanced?: ReactNode;
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
  const [activeMobileTask, setActiveMobileTask] = useState<MobileStudioTaskId>("preview");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs: StudioTab[] = useMemo(
    () => [
      { id: "edit", label: "Edit", eyebrow: "Trim, captions and post copy", content: edit },
      { id: "format", label: "Frame", eyebrow: "Format and crop", content: format },
      { id: "branding", label: "Brand", eyebrow: "Church identity", content: branding },
      { id: "post", label: "Export", eyebrow: "Prepared media and handoff", content: post },
      { id: "evidence", label: "Insights", eyebrow: "Message evidence", content: evidence },
    ],
    [branding, edit, evidence, format, post],
  );

  const activeEyebrow = tabs.find((tab) => tab.id === activeTab)?.eyebrow ?? "Clip tools";
  const mobileTasks: Array<{ id: MobileStudioTaskId; label: string }> = [
    { id: "preview", label: "Preview" },
    { id: "transcript", label: "Transcript" },
    { id: "edit", label: "Edit" },
    { id: "format", label: "Frame" },
    { id: "branding", label: "Brand" },
    { id: "post", label: "Export" },
  ];

  function selectTab(index: number) {
    const nextTab = tabs[index];
    if (!nextTab) {
      return;
    }

    setActiveTab(nextTab.id);
    setActiveMobileTask(nextTab.id);
    tabRefs.current[index]?.focus();
  }

  function scrollToStudioTarget(targetId: string) {
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    target.focus({ preventScroll: true });
  }

  function selectMobileTask(taskId: MobileStudioTaskId) {
    setActiveMobileTask(taskId);

    if (taskId === "preview") {
      scrollToStudioTarget("clip-studio-preview");
      return;
    }

    if (taskId === "transcript") {
      scrollToStudioTarget("clip-studio-transcript");
      return;
    }

    setActiveTab(taskId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => scrollToStudioTarget(`clip-studio-panel-${taskId}`));
    });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    selectTab(nextIndex);
  }

  return (
    <section id="clip-studio-tools" className="clip-studio-workbench stack-md">
      <nav className="clip-studio-mobile-taskbar" aria-label="Clip Studio workflow">
        {mobileTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className={task.id === activeMobileTask ? "clip-studio-mobile-task is-active" : "clip-studio-mobile-task"}
            aria-current={task.id === activeMobileTask ? "step" : undefined}
            onClick={() => selectMobileTask(task.id)}
          >
            {task.label}
          </button>
        ))}
      </nav>

      <div className="clip-studio-workbench-head">
        <div>
          <p className="kicker">Clip inspector</p>
          <h2>{activeEyebrow}</h2>
        </div>
        <div
          className="clip-studio-tabs"
          role="tablist"
          aria-label="Clip Studio tools"
          aria-orientation="horizontal"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`clip-studio-tab-${tab.id}`}
              type="button"
              className={activeTab === tab.id ? "clip-studio-tab is-active" : "clip-studio-tab"}
              onClick={() => {
                setActiveTab(tab.id);
                setActiveMobileTask(tab.id);
              }}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`clip-studio-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`clip-studio-panel-${tab.id}`}
          className="clip-studio-tab-panel"
          role="tabpanel"
          aria-labelledby={`clip-studio-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}

      {advanced ? (
        <details className="clip-studio-editor-disclosure clip-studio-diagnostics-disclosure">
          <summary>
            <span>Production diagnostics</span>
            <span className="muted small">Frame checks, tracking and render details</span>
          </summary>
          <div className="stack-md">{advanced}</div>
        </details>
      ) : null}
    </section>
  );
}
