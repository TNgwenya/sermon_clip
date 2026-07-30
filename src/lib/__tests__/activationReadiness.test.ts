import { describe, expect, it } from "vitest";

import {
  buildActivationReadiness,
  buildYouTubeIntakeReadiness,
} from "@/lib/activationReadiness";

describe("activation readiness", () => {
  it("uses persisted product milestones instead of treating a visited step as complete", () => {
    const readiness = buildActivationReadiness({
      organization: {
        name: "Grace Church",
        timezone: "Africa/Johannesburg",
        defaultLanguage: "en",
      },
      branding: {
        churchName: "Grace Church",
        churchLogoPath: null,
        primaryBrandColor: "#0F766E",
        secondaryBrandColor: "#1D4ED8",
      },
      connectedChannelCount: 1,
      scheduledPostCount: 0,
      cadenceConfigured: false,
      activeApproverCount: 1,
      hasDefaultApprovalPolicy: true,
    });

    expect(readiness.completedCount).toBe(3);
    expect(readiness.percentComplete).toBe(60);
    expect(readiness.nextStep?.id).toBe("brand");
    expect(readiness.steps.find((step) => step.id === "cadence")?.status).toBe("attention");
  });
});

describe("YouTube intake readiness", () => {
  it("never presents an OAuth connection alone as automatic monitoring", () => {
    const readiness = buildYouTubeIntakeReadiness({
      oauthAppConfigured: true,
      accountConnected: true,
      accountNeedsAttention: false,
      connectedAccountLabel: "Grace Church",
      monitoringWorkerConfigured: false,
      intakeReceiverImplemented: false,
      rightsConfirmed: true,
      workflowDefaultsConfigured: true,
      automaticImportEnabled: false,
      workerRecentlyObserved: false,
    });

    expect(readiness.state).toBe("manual_ready");
    expect(readiness.monitoringActive).toBe(false);
    expect(readiness.description).toContain("not currently scanning");
  });

  it("requires every operational gate before reporting active monitoring", () => {
    const readiness = buildYouTubeIntakeReadiness({
      oauthAppConfigured: true,
      accountConnected: true,
      accountNeedsAttention: false,
      connectedAccountLabel: "Grace Church",
      monitoringWorkerConfigured: true,
      intakeReceiverImplemented: true,
      rightsConfirmed: true,
      workflowDefaultsConfigured: true,
      automaticImportEnabled: true,
      workerRecentlyObserved: true,
    });

    expect(readiness.state).toBe("monitoring_active");
    expect(readiness.monitoringActive).toBe(true);
    expect(readiness.checks.every((check) => check.complete)).toBe(true);
  });
});
