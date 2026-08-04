CREATE TYPE "MinistryEventType" AS ENUM (
  'CONFERENCE',
  'REVIVAL',
  'SUMMIT',
  'RETREAT',
  'CAMP',
  'CRUSADE',
  'OTHER'
);

CREATE TYPE "MinistryEventStatus" AS ENUM (
  'DRAFT',
  'UPCOMING',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED'
);

CREATE TYPE "EventSessionType" AS ENUM (
  'PREACHING',
  'WORSHIP',
  'PANEL',
  'WORKSHOP',
  'PRAYER',
  'OTHER'
);

CREATE TYPE "EventSessionStatus" AS ENUM (
  'PLANNED',
  'CANCELLED'
);

CREATE TABLE "MinistryEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "name" TEXT NOT NULL,
  "eventType" "MinistryEventType" NOT NULL DEFAULT 'CONFERENCE',
  "theme" TEXT,
  "description" TEXT,
  "venue" TEXT,
  "timezone" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "MinistryEventStatus" NOT NULL DEFAULT 'DRAFT',
  "logoPath" TEXT,
  "primaryBrandColor" TEXT,
  "secondaryBrandColor" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MinistryEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MinistryEvent_date_range_check" CHECK ("endDate" >= "startDate")
);

CREATE TABLE "EventSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "eventId" TEXT NOT NULL,
  "sermonId" TEXT,
  "title" TEXT NOT NULL,
  "sessionType" "EventSessionType" NOT NULL DEFAULT 'PREACHING',
  "speakerName" TEXT,
  "language" TEXT,
  "scheduledStartAt" TIMESTAMP(3) NOT NULL,
  "scheduledEndAt" TIMESTAMP(3),
  "dayNumber" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" "EventSessionStatus" NOT NULL DEFAULT 'PLANNED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventSession_day_number_check" CHECK ("dayNumber" > 0),
  CONSTRAINT "EventSession_sort_order_check" CHECK ("sortOrder" > 0),
  CONSTRAINT "EventSession_priority_check" CHECK ("priority" BETWEEN 0 AND 100),
  CONSTRAINT "EventSession_time_range_check"
    CHECK ("scheduledEndAt" IS NULL OR "scheduledEndAt" > "scheduledStartAt")
);

CREATE UNIQUE INDEX "MinistryEvent_id_organizationId_key"
  ON "MinistryEvent"("id", "organizationId");
CREATE INDEX "MinistryEvent_organizationId_status_startDate_idx"
  ON "MinistryEvent"("organizationId", "status", "startDate");
CREATE INDEX "MinistryEvent_campusId_status_startDate_idx"
  ON "MinistryEvent"("campusId", "status", "startDate");
CREATE INDEX "MinistryEvent_createdByUserId_createdAt_idx"
  ON "MinistryEvent"("createdByUserId", "createdAt");

CREATE UNIQUE INDEX "EventSession_sermonId_key"
  ON "EventSession"("sermonId");
CREATE UNIQUE INDEX "EventSession_id_organizationId_key"
  ON "EventSession"("id", "organizationId");
CREATE UNIQUE INDEX "EventSession_eventId_dayNumber_sortOrder_key"
  ON "EventSession"("eventId", "dayNumber", "sortOrder");
CREATE INDEX "EventSession_organizationId_scheduledStartAt_idx"
  ON "EventSession"("organizationId", "scheduledStartAt");
CREATE INDEX "EventSession_campusId_scheduledStartAt_idx"
  ON "EventSession"("campusId", "scheduledStartAt");
CREATE INDEX "EventSession_eventId_scheduledStartAt_idx"
  ON "EventSession"("eventId", "scheduledStartAt");
CREATE INDEX "EventSession_eventId_status_scheduledStartAt_idx"
  ON "EventSession"("eventId", "status", "scheduledStartAt");

ALTER TABLE "MinistryEvent"
  ADD CONSTRAINT "MinistryEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MinistryEvent_campusId_organizationId_fkey"
    FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MinistryEvent_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventSession"
  ADD CONSTRAINT "EventSession_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventSession_campusId_organizationId_fkey"
    FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventSession_eventId_organizationId_fkey"
    FOREIGN KEY ("eventId", "organizationId") REFERENCES "MinistryEvent"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventSession_sermonId_fkey"
    FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_event_session_sermon_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  sermon_organization_id TEXT;
  sermon_campus_id TEXT;
BEGIN
  IF NEW."sermonId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "organizationId", "campusId"
  INTO sermon_organization_id, sermon_campus_id
  FROM "Sermon"
  WHERE "id" = NEW."sermonId";

  IF sermon_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Event session and sermon must belong to the same organization';
  END IF;

  IF NEW."campusId" IS NOT NULL
    AND sermon_campus_id IS DISTINCT FROM NEW."campusId" THEN
    RAISE EXCEPTION 'Event session and sermon must belong to the same campus';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "EventSession_sermon_tenant_guard"
BEFORE INSERT OR UPDATE OF "sermonId", "organizationId", "campusId"
ON "EventSession"
FOR EACH ROW
EXECUTE FUNCTION enforce_event_session_sermon_tenant();
