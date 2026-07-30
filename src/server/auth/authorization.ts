/**
 * Provider-agnostic authorization primitives.
 *
 * This module deliberately has no session, database, framework, or transport
 * dependencies. Callers are responsible for translating persisted memberships
 * into an AuthorizationActor and for constructing a context from the resource
 * they have already loaded.
 */

export const ORGANIZATION_ROLES = [
  "OWNER",
  "ORG_ADMIN",
  "CAMPUS_ADMIN",
  "PASTOR_APPROVER",
  "CONTENT_LEAD",
  "EDITOR",
  "PUBLISHER",
  "ANALYST",
  "VIEWER",
  "EXTERNAL_CONTRACTOR",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const AUTHORIZATION_CAPABILITIES = [
  "organization.read",
  "organization.update",
  "organization.transfer",
  "billing.read",
  "billing.manage",
  "members.read",
  "members.manage",
  "invitations.manage",
  "campuses.read",
  "campuses.manage",
  "brand.read",
  "brand.manage",
  "sermons.read",
  "sermons.create",
  "sermons.update",
  "sermons.delete",
  "content.read",
  "content.create",
  "content.update",
  "content.delete",
  "content.export",
  "assignments.read",
  "assignments.manage",
  "comments.read",
  "comments.create",
  "comments.moderate",
  "approvals.read",
  "approvals.request",
  "approvals.decide",
  "approval_policies.manage",
  "channels.read",
  "channels.connect",
  "channels.manage",
  "calendar.read",
  "calendar.manage",
  "publishing.read",
  "publishing.schedule",
  "publishing.publish",
  "publishing.reconcile",
  "analytics.read",
  "analytics.export",
  "audit.read",
  "audit.export",
] as const;

export type AuthorizationCapability = (typeof AUTHORIZATION_CAPABILITIES)[number];

const freezeCapabilities = (
  capabilities: readonly AuthorizationCapability[],
): readonly AuthorizationCapability[] => Object.freeze([...capabilities]);

const READ_ONLY_WORKSPACE_CAPABILITIES = [
  "organization.read",
  "campuses.read",
  "brand.read",
  "sermons.read",
  "content.read",
  "assignments.read",
  "comments.read",
  "approvals.read",
  "channels.read",
  "calendar.read",
  "publishing.read",
  "analytics.read",
] as const satisfies readonly AuthorizationCapability[];

/**
 * Default role templates. Scope is evaluated separately, so the same
 * capability list works for organization-, campus-, and resource-bound roles.
 *
 * Approval and public publishing are intentionally absent from administrative
 * roles. Churches can grant those duties separately and preserve a two-person
 * review policy.
 */
export const ROLE_CAPABILITIES: Readonly<
  Record<OrganizationRole, readonly AuthorizationCapability[]>
> = Object.freeze({
  OWNER: freezeCapabilities(AUTHORIZATION_CAPABILITIES),
  ORG_ADMIN: freezeCapabilities([
    "organization.read",
    "organization.update",
    "billing.read",
    "members.read",
    "members.manage",
    "invitations.manage",
    "campuses.read",
    "campuses.manage",
    "brand.read",
    "brand.manage",
    "sermons.read",
    "sermons.create",
    "sermons.update",
    "sermons.delete",
    "content.read",
    "content.create",
    "content.update",
    "content.delete",
    "content.export",
    "assignments.read",
    "assignments.manage",
    "comments.read",
    "comments.create",
    "comments.moderate",
    "approvals.read",
    "approvals.request",
    "approval_policies.manage",
    "channels.read",
    "channels.connect",
    "channels.manage",
    "calendar.read",
    "calendar.manage",
    "publishing.read",
    "analytics.read",
    "analytics.export",
    "audit.read",
    "audit.export",
  ]),
  CAMPUS_ADMIN: freezeCapabilities([
    "organization.read",
    "members.read",
    "members.manage",
    "invitations.manage",
    "campuses.read",
    "campuses.manage",
    "brand.read",
    "brand.manage",
    "sermons.read",
    "sermons.create",
    "sermons.update",
    "sermons.delete",
    "content.read",
    "content.create",
    "content.update",
    "content.delete",
    "content.export",
    "assignments.read",
    "assignments.manage",
    "comments.read",
    "comments.create",
    "comments.moderate",
    "approvals.read",
    "approvals.request",
    "channels.read",
    "channels.connect",
    "channels.manage",
    "calendar.read",
    "calendar.manage",
    "publishing.read",
    "analytics.read",
    "analytics.export",
    "audit.read",
  ]),
  PASTOR_APPROVER: freezeCapabilities([
    "organization.read",
    "campuses.read",
    "brand.read",
    "sermons.read",
    "content.read",
    "assignments.read",
    "comments.read",
    "comments.create",
    "approvals.read",
    "approvals.request",
    "approvals.decide",
    "calendar.read",
    "publishing.read",
    "analytics.read",
  ]),
  CONTENT_LEAD: freezeCapabilities([
    "organization.read",
    "campuses.read",
    "brand.read",
    "sermons.read",
    "sermons.create",
    "sermons.update",
    "content.read",
    "content.create",
    "content.update",
    "content.delete",
    "content.export",
    "assignments.read",
    "assignments.manage",
    "comments.read",
    "comments.create",
    "comments.moderate",
    "approvals.read",
    "approvals.request",
    "channels.read",
    "calendar.read",
    "calendar.manage",
    "publishing.read",
    "analytics.read",
  ]),
  EDITOR: freezeCapabilities([
    "organization.read",
    "campuses.read",
    "brand.read",
    "sermons.read",
    "content.read",
    "content.create",
    "content.update",
    "content.export",
    "assignments.read",
    "comments.read",
    "comments.create",
    "approvals.read",
    "approvals.request",
    "channels.read",
    "calendar.read",
  ]),
  PUBLISHER: freezeCapabilities([
    "organization.read",
    "campuses.read",
    "brand.read",
    "sermons.read",
    "content.read",
    "content.export",
    "assignments.read",
    "comments.read",
    "comments.create",
    "approvals.read",
    "channels.read",
    "channels.connect",
    "channels.manage",
    "calendar.read",
    "calendar.manage",
    "publishing.read",
    "publishing.schedule",
    "publishing.publish",
    "publishing.reconcile",
    "analytics.read",
  ]),
  ANALYST: freezeCapabilities([
    "organization.read",
    "campuses.read",
    "brand.read",
    "sermons.read",
    "content.read",
    "calendar.read",
    "publishing.read",
    "analytics.read",
    "analytics.export",
  ]),
  VIEWER: freezeCapabilities(READ_ONLY_WORKSPACE_CAPABILITIES),
  EXTERNAL_CONTRACTOR: freezeCapabilities([
    "organization.read",
    "campuses.read",
    "brand.read",
    "sermons.read",
    "content.read",
    "content.create",
    "content.update",
    "content.export",
    "assignments.read",
    "comments.read",
    "comments.create",
    "approvals.read",
    "approvals.request",
    "channels.read",
    "calendar.read",
  ]),
});

export const AUTHORIZATION_RESOURCE_KINDS = [
  "SERMON",
  "WEEK_DRAFT",
  "CONTENT_ITEM",
  "BRAND_KIT",
  "SOCIAL_CHANNEL",
  "CALENDAR",
  "APPROVAL_REQUEST",
  "ANALYTICS_REPORT",
  "MEMBERSHIP",
  "INVITATION",
  "AUDIT_EVENT",
  "BILLING_ACCOUNT",
] as const;

export type AuthorizationResourceKind = (typeof AUTHORIZATION_RESOURCE_KINDS)[number];

export type AuthorizationResource = Readonly<{
  kind: AuthorizationResourceKind;
  id: string;
}>;

export type AuthorizationScope =
  | Readonly<{ kind: "ORGANIZATION" }>
  | Readonly<{ kind: "CAMPUS"; campusId: string }>
  | Readonly<{
      kind: "RESOURCE";
      campusId: string | null;
      resource: AuthorizationResource;
    }>;

export type ScopedRoleBinding = Readonly<{
  role: OrganizationRole;
  scope: AuthorizationScope;
  /**
   * Contractors must always have an expiry. Other roles may optionally be
   * time-boxed, and an invalid or elapsed expiry always denies the binding.
   */
  expiresAt?: Date | string | null;
}>;

export type AuthorizationActor = Readonly<{
  userId: string;
  organizationId: string;
  active: boolean;
  roleBindings: readonly ScopedRoleBinding[];
}>;

/**
 * campusId and resource are explicit nullable fields so callers cannot
 * accidentally omit scope information and receive organization-level access.
 */
export type AuthorizationContext = Readonly<{
  organizationId: string;
  campusId: string | null;
  resource: AuthorizationResource | null;
}>;

export type AuthorizationDenialReason =
  | "INVALID_ACTOR"
  | "INACTIVE_ACTOR"
  | "INVALID_CONTEXT"
  | "ORGANIZATION_MISMATCH"
  | "UNKNOWN_CAPABILITY"
  | "CAPABILITY_MISSING"
  | "SCOPE_MISMATCH";

export type AuthorizationDecision =
  | Readonly<{
      allowed: true;
      role: OrganizationRole;
      scope: AuthorizationScope;
    }>
  | Readonly<{
      allowed: false;
      reason: AuthorizationDenialReason;
    }>;

const ROLE_SET: ReadonlySet<string> = new Set(ORGANIZATION_ROLES);
const CAPABILITY_SET: ReadonlySet<string> = new Set(AUTHORIZATION_CAPABILITIES);
const RESOURCE_KIND_SET: ReadonlySet<string> = new Set(AUTHORIZATION_RESOURCE_KINDS);
const ORGANIZATION_ONLY_ROLES: ReadonlySet<OrganizationRole> = new Set([
  "OWNER",
  "ORG_ADMIN",
]);

function isCanonicalId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

export function isAuthorizationCapability(
  value: unknown,
): value is AuthorizationCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

export function roleHasCapability(
  role: unknown,
  capability: unknown,
): boolean {
  return isOrganizationRole(role)
    && isAuthorizationCapability(capability)
    && ROLE_CAPABILITIES[role].includes(capability);
}

function isAuthorizationResource(value: unknown): value is AuthorizationResource {
  return isRecord(value)
    && typeof value.kind === "string"
    && RESOURCE_KIND_SET.has(value.kind)
    && isCanonicalId(value.id);
}

function isAuthorizationContext(value: unknown): value is AuthorizationContext {
  return isRecord(value)
    && isCanonicalId(value.organizationId)
    && (value.campusId === null || isCanonicalId(value.campusId))
    && (value.resource === null || isAuthorizationResource(value.resource));
}

function isAuthorizationScope(value: unknown): value is AuthorizationScope {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "ORGANIZATION") {
    return true;
  }

  if (value.kind === "CAMPUS") {
    return isCanonicalId(value.campusId);
  }

  return value.kind === "RESOURCE"
    && (value.campusId === null || isCanonicalId(value.campusId))
    && isAuthorizationResource(value.resource);
}

function roleAllowsScope(role: OrganizationRole, scope: AuthorizationScope): boolean {
  if (ORGANIZATION_ONLY_ROLES.has(role)) {
    return scope.kind === "ORGANIZATION";
  }

  if (role === "CAMPUS_ADMIN") {
    return scope.kind === "CAMPUS";
  }

  if (role === "EXTERNAL_CONTRACTOR") {
    return scope.kind === "CAMPUS" || scope.kind === "RESOURCE";
  }

  return true;
}

function bindingExpiryIsActive(
  binding: ScopedRoleBinding,
  now: Date,
): boolean {
  if (binding.role === "EXTERNAL_CONTRACTOR" && binding.expiresAt == null) {
    return false;
  }

  if (binding.expiresAt == null) {
    return true;
  }

  const expiry = binding.expiresAt instanceof Date
    ? binding.expiresAt
    : new Date(binding.expiresAt);

  return Number.isFinite(expiry.getTime()) && expiry.getTime() > now.getTime();
}

function isUsableBinding(
  value: unknown,
  now: Date,
): value is ScopedRoleBinding {
  if (!isRecord(value)
    || !isOrganizationRole(value.role)
    || !isAuthorizationScope(value.scope)
    || !roleAllowsScope(value.role, value.scope)) {
    return false;
  }

  return bindingExpiryIsActive(value as ScopedRoleBinding, now);
}

function isStructurallyValidActor(value: unknown): value is AuthorizationActor {
  return isRecord(value)
    && isCanonicalId(value.userId)
    && isCanonicalId(value.organizationId)
    && typeof value.active === "boolean"
    && Array.isArray(value.roleBindings);
}

export function scopeAllowsContext(
  scope: AuthorizationScope,
  context: AuthorizationContext,
): boolean {
  if (!isAuthorizationScope(scope) || !isAuthorizationContext(context)) {
    return false;
  }

  if (scope.kind === "ORGANIZATION") {
    return true;
  }

  if (scope.kind === "CAMPUS") {
    return context.campusId === scope.campusId;
  }

  return context.campusId === scope.campusId
    && context.resource?.kind === scope.resource.kind
    && context.resource.id === scope.resource.id;
}

export function evaluateAuthorization(
  actor: AuthorizationActor | null | undefined,
  capability: AuthorizationCapability,
  context: AuthorizationContext,
  options: Readonly<{ now?: Date }> = {},
): AuthorizationDecision {
  if (!isStructurallyValidActor(actor)) {
    return { allowed: false, reason: "INVALID_ACTOR" };
  }

  if (!actor.active) {
    return { allowed: false, reason: "INACTIVE_ACTOR" };
  }

  if (!isAuthorizationContext(context)) {
    return { allowed: false, reason: "INVALID_CONTEXT" };
  }

  if (actor.organizationId !== context.organizationId) {
    return { allowed: false, reason: "ORGANIZATION_MISMATCH" };
  }

  if (!isAuthorizationCapability(capability)) {
    return { allowed: false, reason: "UNKNOWN_CAPABILITY" };
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { allowed: false, reason: "INVALID_CONTEXT" };
  }

  const capableBindings = actor.roleBindings.filter((binding) => (
    isUsableBinding(binding, now)
    && roleHasCapability(binding.role, capability)
  ));

  if (capableBindings.length === 0) {
    return { allowed: false, reason: "CAPABILITY_MISSING" };
  }

  const matchingBinding = capableBindings.find((binding) => (
    scopeAllowsContext(binding.scope, context)
  ));

  if (!matchingBinding) {
    return { allowed: false, reason: "SCOPE_MISMATCH" };
  }

  return {
    allowed: true,
    role: matchingBinding.role,
    scope: matchingBinding.scope,
  };
}

export function canActor(
  actor: AuthorizationActor | null | undefined,
  capability: AuthorizationCapability,
  context: AuthorizationContext,
  options?: Readonly<{ now?: Date }>,
): boolean {
  return evaluateAuthorization(actor, capability, context, options).allowed;
}

export class AuthorizationError extends Error {
  readonly reason: AuthorizationDenialReason;

  constructor(reason: AuthorizationDenialReason) {
    super("The actor is not authorized to perform this action.");
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}

export function requireActorCapability(
  actor: AuthorizationActor | null | undefined,
  capability: AuthorizationCapability,
  context: AuthorizationContext,
  options?: Readonly<{ now?: Date }>,
): Extract<AuthorizationDecision, { allowed: true }> {
  const decision = evaluateAuthorization(actor, capability, context, options);
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }

  return decision;
}
