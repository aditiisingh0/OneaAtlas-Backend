/*
  Warnings:

  - You are about to drop the `api_keys` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `audit_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `deployments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `integrations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `org_members` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `organizations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `project_env_vars` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `projects` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_sessions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workflow_runs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workflows` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "org_plan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "org_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "project_type" AS ENUM ('CRUD_APP', 'DASHBOARD', 'ADMIN_PANEL', 'WORKFLOW_APP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "deployment_status" AS ENUM ('QUEUED', 'BUILDING', 'DEPLOYING', 'LIVE', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "deployment_env" AS ENUM ('PREVIEW', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "workflow_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "workflow_run_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "trigger_type" AS ENUM ('MANUAL', 'SCHEDULE', 'WEBHOOK', 'DATABASE_EVENT', 'FORM_SUBMIT', 'API_CALL');

-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('SLACK', 'GMAIL', 'GOOGLE_SHEETS', 'GOOGLE_DRIVE', 'NOTION', 'GITHUB', 'JIRA', 'STRIPE', 'ZAPIER', 'WEBHOOK', 'CUSTOM');

-- DropForeignKey
ALTER TABLE "public"."api_keys" DROP CONSTRAINT "api_keys_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."audit_logs" DROP CONSTRAINT "audit_logs_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."audit_logs" DROP CONSTRAINT "audit_logs_projectId_fkey";

-- DropForeignKey
ALTER TABLE "public"."audit_logs" DROP CONSTRAINT "audit_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."deployments" DROP CONSTRAINT "deployments_projectId_fkey";

-- DropForeignKey
ALTER TABLE "public"."integrations" DROP CONSTRAINT "integrations_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."org_members" DROP CONSTRAINT "org_members_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."org_members" DROP CONSTRAINT "org_members_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."organizations" DROP CONSTRAINT "organizations_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_env_vars" DROP CONSTRAINT "project_env_vars_projectId_fkey";

-- DropForeignKey
ALTER TABLE "public"."projects" DROP CONSTRAINT "projects_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_sessions" DROP CONSTRAINT "user_sessions_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."workflow_runs" DROP CONSTRAINT "workflow_runs_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "public"."workflows" DROP CONSTRAINT "workflows_projectId_fkey";

-- DropTable
DROP TABLE "public"."api_keys";

-- DropTable
DROP TABLE "public"."audit_logs";

-- DropTable
DROP TABLE "public"."deployments";

-- DropTable
DROP TABLE "public"."integrations";

-- DropTable
DROP TABLE "public"."org_members";

-- DropTable
DROP TABLE "public"."organizations";

-- DropTable
DROP TABLE "public"."project_env_vars";

-- DropTable
DROP TABLE "public"."projects";

-- DropTable
DROP TABLE "public"."user_sessions";

-- DropTable
DROP TABLE "public"."users";

-- DropTable
DROP TABLE "public"."workflow_runs";

-- DropTable
DROP TABLE "public"."workflows";

-- DropEnum
DROP TYPE "public"."deployment_env";

-- DropEnum
DROP TYPE "public"."deployment_status";

-- DropEnum
DROP TYPE "public"."integration_provider";

-- DropEnum
DROP TYPE "public"."org_plan";

-- DropEnum
DROP TYPE "public"."org_status";

-- DropEnum
DROP TYPE "public"."project_status";

-- DropEnum
DROP TYPE "public"."project_type";

-- DropEnum
DROP TYPE "public"."trigger_type";

-- DropEnum
DROP TYPE "public"."user_role";

-- DropEnum
DROP TYPE "public"."user_status";

-- DropEnum
DROP TYPE "public"."workflow_run_status";

-- DropEnum
DROP TYPE "public"."workflow_status";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "avatarUrl" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clerkSession" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "plan" "org_plan" NOT NULL DEFAULT 'FREE',
    "status" "org_status" NOT NULL DEFAULT 'ACTIVE',
    "maxApps" INTEGER NOT NULL DEFAULT 3,
    "maxWorkflows" INTEGER NOT NULL DEFAULT 5,
    "maxMembers" INTEGER NOT NULL DEFAULT 5,
    "maxStorageMb" INTEGER NOT NULL DEFAULT 500,
    "aiCallsPerMonth" INTEGER NOT NULL DEFAULT 100,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "planExpiresAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'MEMBER',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "type" "project_type" NOT NULL DEFAULT 'CRUD_APP',
    "status" "project_status" NOT NULL DEFAULT 'DRAFT',
    "prompt" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "subdomain" TEXT NOT NULL,
    "customDomain" TEXT,
    "generatedCode" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_env_vars" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_env_vars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "deployment_status" NOT NULL DEFAULT 'QUEUED',
    "env" "deployment_env" NOT NULL DEFAULT 'PRODUCTION',
    "cfDeploymentId" TEXT,
    "cfWorkerName" TEXT,
    "deployedUrl" TEXT,
    "buildLog" TEXT,
    "buildDuration" INTEGER,
    "errorMessage" TEXT,
    "codeSnapshot" JSONB,
    "triggeredBy" TEXT,
    "deployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "workflow_status" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "trigger_type" NOT NULL DEFAULT 'MANUAL',
    "definition" JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "cronExpression" TEXT,
    "timezone" TEXT DEFAULT 'UTC',
    "webhookSecret" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "successRuns" INTEGER NOT NULL DEFAULT 0,
    "failedRuns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" "workflow_run_status" NOT NULL DEFAULT 'PENDING',
    "trace" JSONB NOT NULL DEFAULT '[]',
    "inputData" JSONB,
    "outputData" JSONB,
    "errorMessage" TEXT,
    "duration" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "name" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_clerkId_idx" ON "users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_clerkSession_key" ON "user_sessions"("clerkSession");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_clerkOrgId_key" ON "organizations"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON "organizations"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeSubscriptionId_key" ON "organizations"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");

-- CreateIndex
CREATE INDEX "org_members_orgId_idx" ON "org_members"("orgId");

-- CreateIndex
CREATE INDEX "org_members_userId_idx" ON "org_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_orgId_userId_key" ON "org_members"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_subdomain_key" ON "projects"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "projects_customDomain_key" ON "projects"("customDomain");

-- CreateIndex
CREATE INDEX "projects_orgId_idx" ON "projects"("orgId");

-- CreateIndex
CREATE INDEX "projects_subdomain_idx" ON "projects"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "projects_orgId_slug_key" ON "projects"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "project_env_vars_projectId_key_key" ON "project_env_vars"("projectId", "key");

-- CreateIndex
CREATE INDEX "deployments_projectId_idx" ON "deployments"("projectId");

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_projectId_version_key" ON "deployments"("projectId", "version");

-- CreateIndex
CREATE INDEX "workflows_projectId_idx" ON "workflows"("projectId");

-- CreateIndex
CREATE INDEX "workflows_status_idx" ON "workflows"("status");

-- CreateIndex
CREATE INDEX "workflow_runs_workflowId_idx" ON "workflow_runs"("workflowId");

-- CreateIndex
CREATE INDEX "workflow_runs_orgId_idx" ON "workflow_runs"("orgId");

-- CreateIndex
CREATE INDEX "workflow_runs_orgId_status_idx" ON "workflow_runs"("orgId", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "integrations_orgId_idx" ON "integrations"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_orgId_provider_key" ON "integrations"("orgId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_orgId_idx" ON "api_keys"("orgId");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_idx" ON "audit_logs"("orgId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_orgId_createdAt_idx" ON "audit_logs"("orgId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_env_vars" ADD CONSTRAINT "project_env_vars_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
