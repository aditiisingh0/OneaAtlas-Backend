// =============================================================================
// packages/db/src/index.ts
// Single entry point for the @oneatlas/db package.
// =============================================================================

// Prisma client
export { prisma } from "./client";
export { default } from "./client";

// Re-export all Prisma types so consumers don't need to import from @prisma/client
export type {
  User,
  UserSession,
  Organization,
  OrgMember,
  Project,
  ProjectEnvVar,
  Deployment,
  Workflow,
  WorkflowRun,
  Integration,
  ApiKey,
  AuditLog,
  // Enums
  UserRole,
  UserStatus,
  OrgPlan,
  OrgStatus,
  ProjectStatus,
  ProjectType,
  DeploymentStatus,
  DeploymentEnv,
  WorkflowStatus,
  WorkflowRunStatus,
  TriggerType,
  IntegrationProvider,
} from "@prisma/client";

// Helpers
export * from "./helpers/pagination";
export * from "./helpers/audit";
