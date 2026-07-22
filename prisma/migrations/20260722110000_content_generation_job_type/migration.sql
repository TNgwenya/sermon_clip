-- PostgreSQL requires a newly added enum value to be committed before it can
-- be referenced by indexes, constraints, or data in a later transaction.
ALTER TYPE "ProcessingJobType" ADD VALUE IF NOT EXISTS 'GENERATE_CONTENT_OPPORTUNITIES';
