-- CreateEnum
CREATE TYPE "WeekDraftStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WeekDraftItemFormat" AS ENUM ('SHORT_FORM_VIDEO', 'QUOTE_GRAPHIC', 'SCRIPTURE_GRAPHIC', 'CAROUSEL', 'TEXT_POST', 'DEVOTIONAL', 'PRAYER', 'SERMON_RECAP', 'STORY', 'GUIDE', 'EMAIL', 'NEWSLETTER', 'BLOG', 'OTHER');

-- CreateEnum
CREATE TYPE "WeekDraftItemStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'SKIPPED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WeekDraftProvenanceType" AS ENUM ('CLIP_CANDIDATE', 'CONTENT_OPPORTUNITY', 'CONTENT_ASSET', 'MANUAL', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "CollaborationAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalPolicyMode" AS ENUM ('ANY_APPROVER', 'ALL_REQUIRED_ROLES', 'QUORUM');

-- CreateEnum
CREATE TYPE "ApprovalPolicyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVE', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "WeekDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "sermonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weekStartsOn" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "WeekDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeekDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekDraftItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "weekDraftId" TEXT NOT NULL,
    "format" "WeekDraftItemFormat" NOT NULL,
    "status" "WeekDraftItemStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "sourceType" "WeekDraftProvenanceType" NOT NULL,
    "sourceId" TEXT,
    "sourceRevisionId" TEXT,
    "provenanceJson" JSONB,
    "assigneeUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "currentRevisionId" TEXT,
    "approvedRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeekDraftItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekDraftItemRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "weekDraftItemId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceType" "WeekDraftProvenanceType" NOT NULL,
    "sourceId" TEXT,
    "sourceRevisionId" TEXT,
    "provenanceJson" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeekDraftItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaborationAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "weekDraftId" TEXT NOT NULL,
    "weekDraftItemId" TEXT,
    "assigneeUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "CollaborationAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollaborationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaborationComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "weekDraftId" TEXT NOT NULL,
    "weekDraftItemId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollaborationComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaborationCommentMention" (
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "commentId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollaborationCommentMention_pkey" PRIMARY KEY ("commentId","mentionedUserId")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "name" TEXT NOT NULL,
    "status" "ApprovalPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "mode" "ApprovalPolicyMode" NOT NULL,
    "minimumApprovals" INTEGER NOT NULL DEFAULT 1,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicyRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "approvalPolicyId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "minimumApprovals" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApprovalPolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "weekDraftId" TEXT NOT NULL,
    "weekDraftItemId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "approvalPolicyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "policySnapshotJson" JSONB NOT NULL,
    "message" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "approvalRequestId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAsRole" "MembershipRole" NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeekDraft_organizationId_status_weekStartsOn_idx" ON "WeekDraft"("organizationId", "status", "weekStartsOn");

-- CreateIndex
CREATE INDEX "WeekDraft_campusId_status_weekStartsOn_idx" ON "WeekDraft"("campusId", "status", "weekStartsOn");

-- CreateIndex
CREATE INDEX "WeekDraft_sermonId_createdAt_idx" ON "WeekDraft"("sermonId", "createdAt");

-- CreateIndex
CREATE INDEX "WeekDraft_createdByUserId_createdAt_idx" ON "WeekDraft"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WeekDraft_dueAt_status_idx" ON "WeekDraft"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraft_id_organizationId_key" ON "WeekDraft"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraft_organizationId_campusId_sermonId_weekStartsOn_key" ON "WeekDraft"("organizationId", "campusId", "sermonId", "weekStartsOn");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItem_currentRevisionId_key" ON "WeekDraftItem"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItem_approvedRevisionId_key" ON "WeekDraftItem"("approvedRevisionId");

-- CreateIndex
CREATE INDEX "WeekDraftItem_organizationId_status_updatedAt_idx" ON "WeekDraftItem"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "WeekDraftItem_campusId_status_updatedAt_idx" ON "WeekDraftItem"("campusId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "WeekDraftItem_weekDraftId_status_sortOrder_idx" ON "WeekDraftItem"("weekDraftId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "WeekDraftItem_assigneeUserId_status_dueAt_idx" ON "WeekDraftItem"("assigneeUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "WeekDraftItem_sourceType_sourceId_idx" ON "WeekDraftItem"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WeekDraftItem_currentRevisionId_idx" ON "WeekDraftItem"("currentRevisionId");

-- CreateIndex
CREATE INDEX "WeekDraftItem_approvedRevisionId_idx" ON "WeekDraftItem"("approvedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItem_id_organizationId_key" ON "WeekDraftItem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItem_id_weekDraftId_organizationId_key" ON "WeekDraftItem"("id", "weekDraftId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItem_organizationId_weekDraftId_sortOrder_key" ON "WeekDraftItem"("organizationId", "weekDraftId", "sortOrder");

-- CreateIndex
CREATE INDEX "WeekDraftItemRevision_organizationId_createdAt_idx" ON "WeekDraftItemRevision"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WeekDraftItemRevision_campusId_createdAt_idx" ON "WeekDraftItemRevision"("campusId", "createdAt");

-- CreateIndex
CREATE INDEX "WeekDraftItemRevision_weekDraftItemId_createdAt_idx" ON "WeekDraftItemRevision"("weekDraftItemId", "createdAt");

-- CreateIndex
CREATE INDEX "WeekDraftItemRevision_contentHash_idx" ON "WeekDraftItemRevision"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItemRevision_id_organizationId_key" ON "WeekDraftItemRevision"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItemRevision_id_weekDraftItemId_organizationId_key" ON "WeekDraftItemRevision"("id", "weekDraftItemId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekDraftItemRevision_weekDraftItemId_revisionNumber_key" ON "WeekDraftItemRevision"("weekDraftItemId", "revisionNumber");

-- CreateIndex
CREATE INDEX "CollaborationAssignment_organizationId_status_dueAt_idx" ON "CollaborationAssignment"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CollaborationAssignment_campusId_status_dueAt_idx" ON "CollaborationAssignment"("campusId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CollaborationAssignment_weekDraftId_status_idx" ON "CollaborationAssignment"("weekDraftId", "status");

-- CreateIndex
CREATE INDEX "CollaborationAssignment_weekDraftItemId_status_idx" ON "CollaborationAssignment"("weekDraftItemId", "status");

-- CreateIndex
CREATE INDEX "CollaborationAssignment_assigneeUserId_status_dueAt_idx" ON "CollaborationAssignment"("assigneeUserId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationAssignment_id_organizationId_key" ON "CollaborationAssignment"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CollaborationComment_organizationId_createdAt_idx" ON "CollaborationComment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationComment_campusId_createdAt_idx" ON "CollaborationComment"("campusId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationComment_weekDraftId_createdAt_idx" ON "CollaborationComment"("weekDraftId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationComment_weekDraftItemId_createdAt_idx" ON "CollaborationComment"("weekDraftItemId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationComment_authorUserId_createdAt_idx" ON "CollaborationComment"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationComment_parentCommentId_createdAt_idx" ON "CollaborationComment"("parentCommentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationComment_id_organizationId_key" ON "CollaborationComment"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CollaborationCommentMention_organizationId_createdAt_idx" ON "CollaborationCommentMention"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationCommentMention_campusId_createdAt_idx" ON "CollaborationCommentMention"("campusId", "createdAt");

-- CreateIndex
CREATE INDEX "CollaborationCommentMention_mentionedUserId_createdAt_idx" ON "CollaborationCommentMention"("mentionedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_organizationId_status_idx" ON "ApprovalPolicy"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_campusId_status_idx" ON "ApprovalPolicy"("campusId", "status");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_createdByUserId_createdAt_idx" ON "ApprovalPolicy"("createdByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_id_organizationId_key" ON "ApprovalPolicy"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_organizationId_campusId_name_key" ON "ApprovalPolicy"("organizationId", "campusId", "name");

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_organizationId_role_idx" ON "ApprovalPolicyRule"("organizationId", "role");

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_campusId_role_idx" ON "ApprovalPolicyRule"("campusId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicyRule_approvalPolicyId_role_key" ON "ApprovalPolicyRule"("approvalPolicyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicyRule_organizationId_approvalPolicyId_sortOrde_key" ON "ApprovalPolicyRule"("organizationId", "approvalPolicyId", "sortOrder");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_status_createdAt_idx" ON "ApprovalRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_campusId_status_createdAt_idx" ON "ApprovalRequest"("campusId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_weekDraftId_status_idx" ON "ApprovalRequest"("weekDraftId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_weekDraftItemId_status_idx" ON "ApprovalRequest"("weekDraftItemId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_revisionId_status_idx" ON "ApprovalRequest"("revisionId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approvalPolicyId_status_idx" ON "ApprovalRequest"("approvalPolicyId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedByUserId_createdAt_idx" ON "ApprovalRequest"("requestedByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_id_revisionId_key" ON "ApprovalRequest"("id", "revisionId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_organizationId_decidedAt_idx" ON "ApprovalDecision"("organizationId", "decidedAt");

-- CreateIndex
CREATE INDEX "ApprovalDecision_campusId_decidedAt_idx" ON "ApprovalDecision"("campusId", "decidedAt");

-- CreateIndex
CREATE INDEX "ApprovalDecision_revisionId_decidedAt_idx" ON "ApprovalDecision"("revisionId", "decidedAt");

-- CreateIndex
CREATE INDEX "ApprovalDecision_decidedByUserId_decidedAt_idx" ON "ApprovalDecision"("decidedByUserId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_approvalRequestId_decidedByUserId_key" ON "ApprovalDecision"("approvalRequestId", "decidedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Campus_id_organizationId_key" ON "Campus"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Sermon_id_organizationId_key" ON "Sermon"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "WeekDraft" ADD CONSTRAINT "WeekDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraft" ADD CONSTRAINT "WeekDraft_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraft" ADD CONSTRAINT "WeekDraft_sermonId_organizationId_fkey" FOREIGN KEY ("sermonId", "organizationId") REFERENCES "Sermon"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraft" ADD CONSTRAINT "WeekDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItem" ADD CONSTRAINT "WeekDraftItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItem" ADD CONSTRAINT "WeekDraftItem_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItem" ADD CONSTRAINT "WeekDraftItem_weekDraftId_organizationId_fkey" FOREIGN KEY ("weekDraftId", "organizationId") REFERENCES "WeekDraft"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItem" ADD CONSTRAINT "WeekDraftItem_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItem" ADD CONSTRAINT "WeekDraftItem_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "WeekDraftItemRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItem" ADD CONSTRAINT "WeekDraftItem_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "WeekDraftItemRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItemRevision" ADD CONSTRAINT "WeekDraftItemRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItemRevision" ADD CONSTRAINT "WeekDraftItemRevision_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItemRevision" ADD CONSTRAINT "WeekDraftItemRevision_weekDraftItemId_organizationId_fkey" FOREIGN KEY ("weekDraftItemId", "organizationId") REFERENCES "WeekDraftItem"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekDraftItemRevision" ADD CONSTRAINT "WeekDraftItemRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationAssignment" ADD CONSTRAINT "CollaborationAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationAssignment" ADD CONSTRAINT "CollaborationAssignment_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationAssignment" ADD CONSTRAINT "CollaborationAssignment_weekDraftId_organizationId_fkey" FOREIGN KEY ("weekDraftId", "organizationId") REFERENCES "WeekDraft"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationAssignment" ADD CONSTRAINT "CollaborationAssignment_weekDraftItemId_weekDraftId_organi_fkey" FOREIGN KEY ("weekDraftItemId", "weekDraftId", "organizationId") REFERENCES "WeekDraftItem"("id", "weekDraftId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationAssignment" ADD CONSTRAINT "CollaborationAssignment_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationAssignment" ADD CONSTRAINT "CollaborationAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationComment" ADD CONSTRAINT "CollaborationComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationComment" ADD CONSTRAINT "CollaborationComment_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationComment" ADD CONSTRAINT "CollaborationComment_weekDraftId_organizationId_fkey" FOREIGN KEY ("weekDraftId", "organizationId") REFERENCES "WeekDraft"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationComment" ADD CONSTRAINT "CollaborationComment_weekDraftItemId_weekDraftId_organizat_fkey" FOREIGN KEY ("weekDraftItemId", "weekDraftId", "organizationId") REFERENCES "WeekDraftItem"("id", "weekDraftId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationComment" ADD CONSTRAINT "CollaborationComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationComment" ADD CONSTRAINT "CollaborationComment_parentCommentId_organizationId_fkey" FOREIGN KEY ("parentCommentId", "organizationId") REFERENCES "CollaborationComment"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationCommentMention" ADD CONSTRAINT "CollaborationCommentMention_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationCommentMention" ADD CONSTRAINT "CollaborationCommentMention_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationCommentMention" ADD CONSTRAINT "CollaborationCommentMention_commentId_organizationId_fkey" FOREIGN KEY ("commentId", "organizationId") REFERENCES "CollaborationComment"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationCommentMention" ADD CONSTRAINT "CollaborationCommentMention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicyRule" ADD CONSTRAINT "ApprovalPolicyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicyRule" ADD CONSTRAINT "ApprovalPolicyRule_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicyRule" ADD CONSTRAINT "ApprovalPolicyRule_approvalPolicyId_organizationId_fkey" FOREIGN KEY ("approvalPolicyId", "organizationId") REFERENCES "ApprovalPolicy"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_weekDraftId_organizationId_fkey" FOREIGN KEY ("weekDraftId", "organizationId") REFERENCES "WeekDraft"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_weekDraftItemId_weekDraftId_organizationId_fkey" FOREIGN KEY ("weekDraftItemId", "weekDraftId", "organizationId") REFERENCES "WeekDraftItem"("id", "weekDraftId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_revisionId_weekDraftItemId_organizationId_fkey" FOREIGN KEY ("revisionId", "weekDraftItemId", "organizationId") REFERENCES "WeekDraftItemRevision"("id", "weekDraftItemId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approvalPolicyId_organizationId_fkey" FOREIGN KEY ("approvalPolicyId", "organizationId") REFERENCES "ApprovalPolicy"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approvalRequestId_revisionId_fkey" FOREIGN KEY ("approvalRequestId", "revisionId") REFERENCES "ApprovalRequest"("id", "revisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "WeekDraftItemRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants Prisma cannot express directly.
ALTER TABLE "WeekDraft"
  ADD CONSTRAINT "WeekDraft_version_check"
  CHECK ("version" > 0);

ALTER TABLE "WeekDraftItem"
  ADD CONSTRAINT "WeekDraftItem_provenance_check"
  CHECK (
    ("sourceType" = 'MANUAL' AND "sourceId" IS NULL)
    OR
    ("sourceType" <> 'MANUAL' AND NULLIF(BTRIM("sourceId"), '') IS NOT NULL)
  );

ALTER TABLE "WeekDraftItemRevision"
  ADD CONSTRAINT "WeekDraftItemRevision_number_check"
  CHECK ("revisionNumber" > 0),
  ADD CONSTRAINT "WeekDraftItemRevision_hash_check"
  CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "WeekDraftItemRevision_provenance_check"
  CHECK (
    ("sourceType" = 'MANUAL' AND "sourceId" IS NULL)
    OR
    ("sourceType" <> 'MANUAL' AND NULLIF(BTRIM("sourceId"), '') IS NOT NULL)
  );

ALTER TABLE "CollaborationAssignment"
  ADD CONSTRAINT "CollaborationAssignment_completion_check"
  CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
    OR
    ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  );

ALTER TABLE "CollaborationComment"
  ADD CONSTRAINT "CollaborationComment_body_check"
  CHECK (NULLIF(BTRIM("body"), '') IS NOT NULL);

ALTER TABLE "ApprovalPolicy"
  ADD CONSTRAINT "ApprovalPolicy_minimum_check"
  CHECK ("minimumApprovals" > 0);

ALTER TABLE "ApprovalPolicyRule"
  ADD CONSTRAINT "ApprovalPolicyRule_minimum_check"
  CHECK ("minimumApprovals" > 0);

ALTER TABLE "ApprovalRequest"
  ADD CONSTRAINT "ApprovalRequest_resolution_check"
  CHECK (
    ("status" = 'PENDING' AND "resolvedAt" IS NULL AND "cancelledAt" IS NULL)
    OR
    ("status" = 'CANCELLED' AND "resolvedAt" IS NOT NULL AND "cancelledAt" IS NOT NULL)
    OR
    ("status" IN ('APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED')
      AND "resolvedAt" IS NOT NULL)
  );

ALTER TABLE "ApprovalDecision"
  ADD CONSTRAINT "ApprovalDecision_reason_check"
  CHECK (
    "decision" = 'APPROVE'
    OR NULLIF(BTRIM("reason"), '') IS NOT NULL
  );

-- PostgreSQL treats NULL campus keys as distinct. These partial indexes make
-- organization-wide drafts and policies just as deterministic as campus ones.
CREATE UNIQUE INDEX "WeekDraft_org_sermon_week_key"
  ON "WeekDraft"("organizationId", "sermonId", "weekStartsOn")
  WHERE "campusId" IS NULL;

CREATE UNIQUE INDEX "ApprovalPolicy_org_name_key"
  ON "ApprovalPolicy"("organizationId", "name")
  WHERE "campusId" IS NULL;

CREATE UNIQUE INDEX "ApprovalPolicy_active_org_default_key"
  ON "ApprovalPolicy"("organizationId")
  WHERE "campusId" IS NULL
    AND "isDefault" = true
    AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ApprovalPolicy_active_campus_default_key"
  ON "ApprovalPolicy"("organizationId", "campusId")
  WHERE "campusId" IS NOT NULL
    AND "isDefault" = true
    AND "status" = 'ACTIVE';

-- One active assignment per assignee/target and one open approval per item.
CREATE UNIQUE INDEX "CollaborationAssignment_active_draft_assignee_key"
  ON "CollaborationAssignment"("weekDraftId", "assigneeUserId")
  WHERE "weekDraftItemId" IS NULL
    AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "CollaborationAssignment_active_item_assignee_key"
  ON "CollaborationAssignment"("weekDraftItemId", "assigneeUserId")
  WHERE "weekDraftItemId" IS NOT NULL
    AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ApprovalRequest_pending_item_key"
  ON "ApprovalRequest"("weekDraftItemId")
  WHERE "status" = 'PENDING';
