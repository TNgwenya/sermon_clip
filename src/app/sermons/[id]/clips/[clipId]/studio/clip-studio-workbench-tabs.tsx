"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-workbench-tabs.module.css";

type StudioMode = "quick" | "advanced";
type StudioTabId = "edit" | "format" | "branding" | "post" | "advanced";
type MobileStudioTaskId = "preview" | "transcript" | StudioTabId;

type StudioTab = {
  id: StudioTabId;
  label: string;
  description: string;
  stepLabel: string;
  icon: "captions" | "frame" | "brand" | "export" | "advanced";
  content: ReactNode;
};

type StudioGuidance = {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  nextTabId: StudioTabId | null;
  nextLabel: string | null;
};

type ClipStudioWorkbenchTabsProps = {
  edit: ReactNode;
  format: ReactNode;
  branding: ReactNode;
  post: ReactNode;
  advanced?: ReactNode;
};

const STUDIO_MODES: StudioMode[] = ["quick", "advanced"];

function resolveStudioTabIndex({
  key,
  index,
  tabCount,
}: {
  key: string;
  index: number;
  tabCount: number;
}): number | null {
  if (key === "ArrowRight") {
    return (index + 1) % tabCount;
  }

  if (key === "ArrowLeft") {
    return (index - 1 + tabCount) % tabCount;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return tabCount - 1;
  }

  return null;
}

function resolveStudioModeIndex({
  key,
  index,
}: {
  key: string;
  index: number;
}): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (index + 1) % STUDIO_MODES.length;
  }

  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (index - 1 + STUDIO_MODES.length) % STUDIO_MODES.length;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return STUDIO_MODES.length - 1;
  }

  return null;
}

function shouldIncludeAdvancedStudioTab({
  mode,
  hasAdvancedContent,
}: {
  mode: StudioMode;
  hasAdvancedContent: boolean;
}): boolean {
  return mode === "advanced" && hasAdvancedContent;
}

function getStudioTabPresentation(
  mode: StudioMode,
  id: StudioTabId,
): Pick<StudioTab, "label" | "description" | "stepLabel"> {
  const quick: Record<Exclude<StudioTabId, "advanced">, Pick<StudioTab, "label" | "description" | "stepLabel">> = {
    edit: {
      label: "Words & sound",
      description: "Captions, opening and natural pacing",
      stepLabel: "Step 1",
    },
    format: {
      label: "Fit the frame",
      description: "Platform size and speaker framing",
      stepLabel: "Step 2",
    },
    branding: {
      label: "Apply brand",
      description: "Church logo, colours and cover",
      stepLabel: "Step 3",
    },
    post: {
      label: "Finish",
      description: "Final checks and publishing handoff",
      stepLabel: "Step 4",
    },
  };
  const advanced: Record<StudioTabId, Pick<StudioTab, "label" | "description" | "stepLabel">> = {
    edit: {
      label: "Edit & audio",
      description: "Caption timing, layers, hooks and pacing",
      stepLabel: "Creative",
    },
    format: {
      label: "Canvas & crop",
      description: "Aspect ratio, tracking and exact framing",
      stepLabel: "Layout",
    },
    branding: {
      label: "Brand & overlays",
      description: "Identity, cover frame and visual layers",
      stepLabel: "Design",
    },
    post: {
      label: "Export setup",
      description: "Output validation and publishing handoff",
      stepLabel: "Delivery",
    },
    advanced: {
      label: "Diagnostics",
      description: "Tracking, render and quality evidence",
      stepLabel: "Inspect",
    },
  };

  if (mode === "quick" && id !== "advanced") {
    return quick[id];
  }

  return advanced[id];
}

function getStudioGuidance(mode: StudioMode, activeTab: StudioTabId): StudioGuidance {
  if (mode === "advanced") {
    if (activeTab === "advanced") {
      return {
        eyebrow: "Expert inspection",
        title: "Verify the media pipeline",
        description: "Inspect tracking, render, and quality evidence when the preview needs technical diagnosis.",
        actionLabel: "Review diagnostic evidence",
        nextTabId: null,
        nextLabel: null,
      };
    }

    return {
      eyebrow: "Advanced Studio",
      title: "Precision controls are unlocked",
      description: "Use every creative control in this workspace, or open Diagnostics for tracking and render evidence.",
      actionLabel: "Open active controls",
      nextTabId: "advanced",
      nextLabel: "Open diagnostics",
    };
  }

  const guidance: Record<Exclude<StudioTabId, "advanced">, StudioGuidance> = {
    edit: {
      eyebrow: "Quick path · 1 of 4",
      title: "Check the words and sound",
      description: "Correct visible captions, confirm the opening, and keep the sermon’s pacing natural.",
      actionLabel: "Start with captions",
      nextTabId: "format",
      nextLabel: "Next: fit the frame",
    },
    format: {
      eyebrow: "Quick path · 2 of 4",
      title: "Fit the speaker to the screen",
      description: "Choose the publishing shape and confirm that the speaker stays safely framed.",
      actionLabel: "Review framing",
      nextTabId: "branding",
      nextLabel: "Next: apply brand",
    },
    branding: {
      eyebrow: "Quick path · 3 of 4",
      title: "Make it unmistakably your church",
      description: "Check the logo, colours, and cover frame without rebuilding the Brand Kit.",
      actionLabel: "Review church branding",
      nextTabId: "post",
      nextLabel: "Next: final checks",
    },
    post: {
      eyebrow: "Quick path · 4 of 4",
      title: "Run the final check",
      description: "Review readiness, prepare the final video, and hand it to the publishing workflow.",
      actionLabel: "Open final checks",
      nextTabId: null,
      nextLabel: null,
    },
  };

  return guidance[activeTab === "advanced" ? "edit" : activeTab];
}

function StudioToolIcon({ icon }: { icon: StudioTab["icon"] }) {
  if (icon === "captions") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="17" height="14" rx="3" />
        <path d="M7 10h4M7 14h7M15 10h2" />
      </svg>
    );
  }

  if (icon === "frame") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4M16 21h4a1 1 0 0 0 1-1v-4" />
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </svg>
    );
  }

  if (icon === "brand") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m12 3 2.2 5.1L20 9l-4 4 .9 5.7L12 16l-4.9 2.7L8 13 4 9l5.8-.9L12 3Z" />
      </svg>
    );
  }

  if (icon === "export") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
    </svg>
  );
}

export function ClipStudioWorkbenchTabs({
  edit,
  format,
  branding,
  post,
  advanced,
}: ClipStudioWorkbenchTabsProps) {
  const [studioMode, setStudioMode] = useState<StudioMode>("quick");
  const [activeTab, setActiveTab] = useState<StudioTabId>("edit");
  const [activeMobileTask, setActiveMobileTask] = useState<MobileStudioTaskId>("preview");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs: StudioTab[] = useMemo(
    () => {
      const editPresentation = getStudioTabPresentation(studioMode, "edit");
      const formatPresentation = getStudioTabPresentation(studioMode, "format");
      const brandingPresentation = getStudioTabPresentation(studioMode, "branding");
      const postPresentation = getStudioTabPresentation(studioMode, "post");
      const quickTabs: StudioTab[] = [
        {
          id: "edit",
          ...editPresentation,
          icon: "captions",
          content: edit,
        },
        {
          id: "format",
          ...formatPresentation,
          icon: "frame",
          content: format,
        },
        {
          id: "branding",
          ...brandingPresentation,
          icon: "brand",
          content: branding,
        },
        {
          id: "post",
          ...postPresentation,
          icon: "export",
          content: post,
        },
      ];

      if (shouldIncludeAdvancedStudioTab({
        mode: studioMode,
        hasAdvancedContent: Boolean(advanced),
      })) {
        const advancedPresentation = getStudioTabPresentation("advanced", "advanced");
        quickTabs.push({
          id: "advanced",
          ...advancedPresentation,
          icon: "advanced",
          content: advanced,
        });
      }

      return quickTabs;
    },
    [advanced, branding, edit, format, post, studioMode],
  );
  const guidance = getStudioGuidance(studioMode, activeTab);

  const mobileTasks: Array<{ id: MobileStudioTaskId; label: string }> = [
    { id: "preview", label: "Preview" },
    { id: "transcript", label: "Script" },
    ...tabs.map((tab) => ({ id: tab.id, label: tab.label })),
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

  function selectTabById(tabId: StudioTabId) {
    const tabIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex < 0) {
      return;
    }

    selectTab(tabIndex);
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
    const nextIndex = resolveStudioTabIndex({
      key: event.key,
      index,
      tabCount: tabs.length,
    });

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    selectTab(nextIndex);
  }

  function handleModeKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = resolveStudioModeIndex({
      key: event.key,
      index,
    });
    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextMode = STUDIO_MODES[nextIndex];
    selectStudioMode(nextMode);
    modeRefs.current[nextIndex]?.focus();
  }

  function selectStudioMode(nextMode: StudioMode) {
    setStudioMode(nextMode);
    if (nextMode === "quick" && activeTab === "advanced") {
      setActiveTab("edit");
      setActiveMobileTask("edit");
    }
  }

  return (
    <section id="clip-studio-tools" className={`clip-studio-workbench stack-md ${styles.workbench}`}>
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

      <header className={styles.modeHeader}>
        <div className={styles.modeTitle}>
          <p className={styles.eyebrow}>Editing workspace</p>
          <div className={styles.modeTitleRow}>
            <h2>{studioMode === "quick" ? "Quick Finish" : "Advanced Studio"}</h2>
            <span>{studioMode === "quick" ? "4 guided steps" : `${tabs.length} expert areas`}</span>
          </div>
          <p className={styles.modeDescription} id="clip-studio-mode-description">
            {studioMode === "quick"
              ? "Use the shortest safe path from approved moment to publishable clip."
              : "Open the complete creative toolset plus technical evidence and diagnostics."}
          </p>
        </div>
        <div className={styles.modeControls}>
          <div
            className={styles.modeSwitch}
            role="group"
            aria-label="Studio editing mode"
            aria-describedby="clip-studio-mode-description"
          >
            <button
              ref={(element) => {
                modeRefs.current[0] = element;
              }}
              type="button"
              className={studioMode === "quick" ? styles.modeActive : undefined}
              aria-pressed={studioMode === "quick"}
              onClick={() => selectStudioMode("quick")}
              onKeyDown={(event) => handleModeKeyDown(event, 0)}
            >
              <strong>Quick Finish</strong>
              <small>Guided essentials</small>
            </button>
            <button
              ref={(element) => {
                modeRefs.current[1] = element;
              }}
              type="button"
              className={studioMode === "advanced" ? styles.modeActive : undefined}
              aria-pressed={studioMode === "advanced"}
              onClick={() => selectStudioMode("advanced")}
              onKeyDown={(event) => handleModeKeyDown(event, 1)}
            >
              <strong>Advanced</strong>
              <small>All controls</small>
            </button>
          </div>
          <span className={styles.liveCue}>
            <span aria-hidden="true" />
            Preview updates live
          </span>
        </div>
      </header>

      <div className={`clip-studio-workbench-head ${styles.toolHeader}`}>
        <h2 className="sr-only">Clip inspector</h2>
        <div
          className={`clip-studio-tabs ${styles.toolRail}`}
          role="tablist"
          aria-label="Clip Studio tools"
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
              aria-label={`${tab.stepLabel}: ${tab.label}. ${tab.description}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
            >
              <span className={styles.toolIcon}>
                <StudioToolIcon icon={tab.icon} />
              </span>
              <span className={styles.toolCopy}>
                <span>{tab.stepLabel}</span>
                <strong>{tab.label}</strong>
                <small>{tab.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <section
        className={`${styles.guidance} ${studioMode === "advanced" ? styles.guidanceAdvanced : ""}`}
        aria-labelledby="clip-studio-guidance-title"
        aria-live="polite"
      >
        <div className={styles.guidanceCopy}>
          <p>{guidance.eyebrow}</p>
          <h3 id="clip-studio-guidance-title">{guidance.title}</h3>
          <span>{guidance.description}</span>
        </div>
        <div className={styles.guidanceActions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => scrollToStudioTarget(`clip-studio-panel-${activeTab}`)}
          >
            {guidance.actionLabel}
          </button>
          {guidance.nextTabId && guidance.nextLabel ? (
            <button
              type="button"
              className={styles.nextAction}
              onClick={() => selectTabById(guidance.nextTabId!)}
            >
              {guidance.nextLabel}
              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <span className={styles.finishCue}>
              {studioMode === "quick" ? "Finish here" : "Inspect as needed"}
            </span>
          )}
        </div>
      </section>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`clip-studio-panel-${tab.id}`}
          className={`clip-studio-tab-panel ${styles.toolPanel}`}
          role="tabpanel"
          aria-labelledby={`clip-studio-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}

      <details className={styles.shortcutDisclosure}>
        <summary>Keyboard shortcuts <span>Optional</span></summary>
        <footer className={styles.keyboardHint} aria-label="Studio keyboard shortcuts">
          <span><kbd>←</kbd><kbd>→</kbd> Previous or next tool</span>
          <span><kbd>Home</kbd> First tool</span>
          <span><kbd>End</kbd> Last tool</span>
        </footer>
      </details>
    </section>
  );
}

export const __clipStudioWorkbenchTabsTestUtils = {
  getStudioGuidance,
  getStudioTabPresentation,
  resolveStudioModeIndex,
  resolveStudioTabIndex,
  shouldIncludeAdvancedStudioTab,
};
