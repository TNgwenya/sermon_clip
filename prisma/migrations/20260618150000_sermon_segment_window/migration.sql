ALTER TABLE "Sermon" ADD COLUMN "sourceDurationSeconds" REAL;
ALTER TABLE "Sermon" ADD COLUMN "sermonStartSeconds" REAL;
ALTER TABLE "Sermon" ADD COLUMN "sermonEndSeconds" REAL;
ALTER TABLE "Sermon" ADD COLUMN "analyzeFullRecording" BOOLEAN NOT NULL DEFAULT false;
