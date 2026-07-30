export type ActivationStepId =
  | "identity"
  | "brand"
  | "channels"
  | "cadence"
  | "approver";

export type ActivationStepStatus = "complete" | "attention";

export type ActivationStep = Readonly<{
  id: ActivationStepId;
  title: string;
  description: string;
  status: ActivationStepStatus;
  statusLabel: string;
  href: string;
  actionLabel: string;
}>;

export type ActivationReadiness = Readonly<{
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  nextStep: ActivationStep | null;
  steps: readonly ActivationStep[];
}>;

export type ActivationReadinessInput = Readonly<{
  organization: {
    name: string;
    timezone: string;
    defaultLanguage: string;
  };
  branding: {
    churchName: string;
    churchLogoPath: string | null;
    primaryBrandColor: string;
    secondaryBrandColor: string;
  } | null;
  connectedChannelCount: number;
  scheduledPostCount: number;
  cadenceConfigured?: boolean;
  activeApproverCount: number;
  hasDefaultApprovalPolicy: boolean;
}>;

const DEFAULT_BRAND_COLORS = new Set(["#0F766E", "#1D4ED8"]);

function meaningful(value: string): boolean {
  return value.trim().length > 0;
}

function customizedBrand(input: ActivationReadinessInput["branding"]): boolean {
  if (!input) return false;

  return Boolean(input.churchLogoPath?.trim())
    || !DEFAULT_BRAND_COLORS.has(input.primaryBrandColor.toUpperCase())
    || !DEFAULT_BRAND_COLORS.has(input.secondaryBrandColor.toUpperCase());
}

export function buildActivationReadiness(
  input: ActivationReadinessInput,
): ActivationReadiness {
  const identityComplete = meaningful(input.organization.name)
    && meaningful(input.organization.timezone)
    && meaningful(input.organization.defaultLanguage);
  const brandComplete = Boolean(
    input.branding
      && meaningful(input.branding.churchName)
      && customizedBrand(input.branding),
  );
  const channelsComplete = input.connectedChannelCount > 0;
  const cadenceComplete = input.cadenceConfigured === true || input.scheduledPostCount > 0;
  const approverComplete = input.activeApproverCount > 0
    && input.hasDefaultApprovalPolicy;

  const steps: ActivationStep[] = [
    {
      id: "identity",
      title: "Church identity",
      description: "Name, language, and timezone keep every plan and handoff locally correct.",
      status: identityComplete ? "complete" : "attention",
      statusLabel: identityComplete ? "Saved" : "Finish setup",
      href: "#church-identity",
      actionLabel: identityComplete ? "Review identity" : "Add identity",
    },
    {
      id: "brand",
      title: "Brand Kit",
      description: "Add a recognizable logo or church color treatment before clips are exported.",
      status: brandComplete ? "complete" : "attention",
      statusLabel: brandComplete ? "Customized" : "Customize",
      href: "/settings/branding",
      actionLabel: brandComplete ? "Review Brand Kit" : "Set up Brand Kit",
    },
    {
      id: "channels",
      title: "Church channels",
      description: "Connect at least one owned social account for analytics and approved publishing.",
      status: channelsComplete ? "complete" : "attention",
      statusLabel: channelsComplete ? "Connected" : "Connect one",
      href: "/settings/social",
      actionLabel: channelsComplete ? "Manage channels" : "Connect a channel",
    },
    {
      id: "cadence",
      title: "Weekly cadence",
      description: "Place at least one approved item on the calendar to establish the team rhythm.",
      status: cadenceComplete ? "complete" : "attention",
      statusLabel: cadenceComplete ? "Calendar started" : "Plan the week",
      href: "/ready-to-post",
      actionLabel: cadenceComplete ? "Review calendar" : "Plan first post",
    },
    {
      id: "approver",
      title: "Pastor approval",
      description: "Use an active pastor approver and a default policy before content reaches publishing.",
      status: approverComplete ? "complete" : "attention",
      statusLabel: approverComplete ? "Protected" : "Needs setup",
      href: "/settings/team",
      actionLabel: approverComplete ? "Review access" : "Set approver access",
    },
  ];
  const completedCount = steps.filter((step) => step.status === "complete").length;

  return {
    completedCount,
    totalCount: steps.length,
    percentComplete: Math.round((completedCount / steps.length) * 100),
    nextStep: steps.find((step) => step.status === "attention") ?? null,
    steps,
  };
}

export type YouTubeIntakeState =
  | "developer_setup"
  | "connect_account"
  | "connection_attention"
  | "manual_ready"
  | "ready_to_enable"
  | "monitoring_waiting"
  | "monitoring_active";

export type YouTubeIntakeReadiness = Readonly<{
  state: YouTubeIntakeState;
  title: string;
  description: string;
  connectedAccountLabel: string | null;
  monitoringActive: boolean;
  checks: readonly Readonly<{
    label: string;
    complete: boolean;
    detail: string;
  }>[];
}>;

export function buildYouTubeIntakeReadiness(input: Readonly<{
  oauthAppConfigured: boolean;
  accountConnected: boolean;
  accountNeedsAttention: boolean;
  connectedAccountLabel?: string | null;
  monitoringWorkerConfigured: boolean;
  intakeReceiverImplemented: boolean;
  rightsConfirmed?: boolean;
  workflowDefaultsConfigured?: boolean;
  automaticImportEnabled?: boolean;
  workerRecentlyObserved?: boolean;
}>): YouTubeIntakeReadiness {
  const checks = [
    {
      label: "YouTube app credentials",
      complete: input.oauthAppConfigured,
      detail: input.oauthAppConfigured
        ? "This deployment can begin YouTube authorization."
        : "A workspace developer must add the YouTube OAuth client id and secret.",
    },
    {
      label: "Church channel authorization",
      complete: input.accountConnected && !input.accountNeedsAttention,
      detail: input.accountConnected
        ? input.accountNeedsAttention
          ? "The saved connection needs to be authorized again."
          : `${input.connectedAccountLabel?.trim() || "The church channel"} is connected for supported YouTube features.`
        : "No YouTube channel has been connected to this church workspace.",
    },
    {
      label: "Recording rights confirmation",
      complete: input.rightsConfirmed === true,
      detail: input.rightsConfirmed
        ? "A workspace administrator confirmed permission for future public channel sermons."
        : "An administrator must explicitly confirm rights before automatic imports can be enabled.",
    },
    {
      label: "Import defaults and weekly rhythm",
      complete: input.workflowDefaultsConfigured === true,
      detail: input.workflowDefaultsConfigured
        ? "Speaker, language, notification contact, and weekly cadence are saved."
        : "Save the speaker, language, notification contact, and weekly cadence first.",
    },
    {
      label: "New-sermon monitoring service",
      complete: input.monitoringWorkerConfigured,
      detail: input.monitoringWorkerConfigured
        ? "The monitoring service is configured."
        : "No channel polling or push monitoring service is configured.",
    },
    {
      label: "Safe intake receiver",
      complete: input.intakeReceiverImplemented,
      detail: input.intakeReceiverImplemented
        ? "Discovered videos can be deduplicated and queued for review."
        : "Automatic discovery cannot create sermon projects in this release.",
    },
  ] as const;
  const allConfigured = checks.every((check) => check.complete);
  const monitoringActive = allConfigured
    && input.automaticImportEnabled === true
    && input.workerRecentlyObserved === true;

  if (monitoringActive) {
    return {
      state: "monitoring_active",
      title: "Automatic sermon monitoring is active",
      description: "New channel videos can be discovered and queued for the church team to confirm.",
      connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
      monitoringActive,
      checks,
    };
  }

  if (!input.oauthAppConfigured) {
    return {
      state: "developer_setup",
      title: "YouTube needs developer setup",
      description: "Manual YouTube links still work. Automatic channel monitoring is not active.",
      connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
      monitoringActive,
      checks,
    };
  }

  if (!input.accountConnected) {
    return {
      state: "connect_account",
      title: "Connect the church YouTube channel",
      description: "Connection enables supported analytics and publishing features. It does not turn on automatic sermon discovery.",
      connectedAccountLabel: null,
      monitoringActive,
      checks,
    };
  }

  if (input.accountNeedsAttention) {
    return {
      state: "connection_attention",
      title: "Reconnect the church YouTube channel",
      description: "The saved authorization needs attention. Automatic sermon monitoring is not active.",
      connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
      monitoringActive,
      checks,
    };
  }

  if (!input.rightsConfirmed || !input.workflowDefaultsConfigured) {
    return {
      state: "manual_ready",
      title: "YouTube is connected; finish the safety setup",
      description: "Manual links work now. Automatic discovery remains off until rights and import defaults are saved.",
      connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
      monitoringActive,
      checks,
    };
  }

  if (!input.automaticImportEnabled && allConfigured) {
    return {
      state: "ready_to_enable",
      title: "Automatic intake is ready to enable",
      description: "The channel, rights, workflow defaults, and monitoring service are ready. Automation remains off until an administrator enables it.",
      connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
      monitoringActive,
      checks,
    };
  }

  if (input.automaticImportEnabled && allConfigured && !input.workerRecentlyObserved) {
    return {
      state: "monitoring_waiting",
      title: "Automatic intake is enabled; waiting for a worker scan",
      description: "The settings are active, but SermonClip has not observed a recent scan yet. Do not assume the channel is being watched until a scan time appears.",
      connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
      monitoringActive,
      checks,
    };
  }

  return {
    state: "manual_ready",
    title: "YouTube is connected; sermon intake is still manual",
    description: "Paste each sermon link when it is ready. SermonClip is not currently scanning the channel for new uploads.",
    connectedAccountLabel: input.connectedAccountLabel?.trim() || null,
    monitoringActive,
    checks,
  };
}
