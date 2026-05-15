-- Migration: add_org_indexes
-- Adds orgId column + indexes to workflow_runs, and composite index to audit_logs

-- 1. Add orgId to workflow_runs (backfill via join)
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "orgId" TEXT;

UPDATE "workflow_runs" wr
SET "orgId" = p."orgId"
FROM "workflows" w
JOIN "projects" p ON p.id = w."projectId"
WHERE wr."workflowId" = w.id;

-- Make it NOT NULL after backfill
ALTER TABLE "workflow_runs" ALTER COLUMN "orgId" SET NOT NULL;

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS "workflow_runs_orgId_idx"        ON "workflow_runs"("orgId");
CREATE INDEX IF NOT EXISTS "workflow_runs_orgId_status_idx" ON "workflow_runs"("orgId", "status");

-- 3. Composite index on audit_logs for paginated org audit feed
CREATE INDEX IF NOT EXISTS "audit_logs_orgId_createdAt_idx" ON "audit_logs"("orgId", "createdAt" DESC);
