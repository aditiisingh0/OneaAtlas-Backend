// =============================================================================
// packages/shared/src/validators.ts
// Zod schemas used for API request validation across all routes.
// =============================================================================

import { z } from "zod";
import { SLUG_REGEX } from "./constants";

// ── Primitives ────────────────────────────────────────────────────────────────

export const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(SLUG_REGEX, "Slug must only contain lowercase letters, numbers, and hyphens");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// ── User ─────────────────────────────────────────────────────────────────────

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
});

// ── Organization ──────────────────────────────────────────────────────────────

export const createOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: slugSchema,
});

export const updateOrgSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  logoUrl: z.string().url().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});

// ── Project ───────────────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(2).max(100),
  prompt: z.string().min(10).max(5000),
  type: z
    .enum(["CRUD_APP", "DASHBOARD", "ADMIN_PANEL", "WORKFLOW_APP", "CUSTOM"])
    .default("CRUD_APP"),
  description: z.string().max(500).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  customDomain: z.string().max(253).optional(),
});

export const projectEnvVarSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z0-9_]+$/, "Env var key must be uppercase letters, numbers, or underscores"),
  value: z.string().max(5000),
  isSecret: z.boolean().default(true),
});

// ── Deployment ────────────────────────────────────────────────────────────────

export const createDeploymentSchema = z.object({
  env: z.enum(["PREVIEW", "PRODUCTION"]).default("PRODUCTION"),
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["trigger", "action", "condition", "ai_step", "delay"]),
  triggerType: z
    .enum(["MANUAL", "SCHEDULE", "WEBHOOK", "DATABASE_EVENT", "FORM_SUBMIT", "API_CALL"])
    .optional(),
  provider: z
    .enum(["SLACK", "GMAIL", "GOOGLE_SHEETS", "GOOGLE_DRIVE", "NOTION", "GITHUB", "JIRA", "STRIPE", "ZAPIER", "WEBHOOK", "CUSTOM"])
    .optional(),
  config: z.record(z.unknown()).default({}),
});

export const workflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
});

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  triggerType: z
    .enum(["MANUAL", "SCHEDULE", "WEBHOOK", "DATABASE_EVENT", "FORM_SUBMIT", "API_CALL"])
    .default("MANUAL"),
  definition: workflowDefinitionSchema.optional(),
  cronExpression: z.string().optional(),
  timezone: z.string().default("UTC"),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  definition: workflowDefinitionSchema.optional(),
  cronExpression: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).optional(),
});

// ── AI Generation ─────────────────────────────────────────────────────────────

export const generateAppSchema = z.object({
  prompt: z.string().min(10).max(5000),
  projectType: z
    .enum(["CRUD_APP", "DASHBOARD", "ADMIN_PANEL", "WORKFLOW_APP", "CUSTOM"])
    .default("CRUD_APP"),
  orgId: z.string().cuid(),
});

export const iterateAppSchema = z.object({
  projectId: z.string().cuid(),
  instruction: z.string().min(5).max(2000),
});

// ── Types inferred from schemas ───────────────────────────────────────────────

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectEnvVarInput = z.infer<typeof projectEnvVarSchema>;
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type GenerateAppInput = z.infer<typeof generateAppSchema>;
export type IterateAppInput = z.infer<typeof iterateAppSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
