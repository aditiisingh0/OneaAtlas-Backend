// =============================================================================
// apps/api/src/lib/queue/workers.ts
//
// Row 17 — Queue System: Job Workers (fully wired)
//
// Each worker function:
//   1. Dequeues one job
//   2. Executes the job (deploy / AI generation)
//   3. Acks on success or fails with retry/dead-letter logic
//
// These are called from:
//   - The /api/v1/admin/queue/process route (triggered by Vercel Cron)
//   - Any serverless invocation that wants to drain the queue
//
// AI generation pipeline (Row 17 completion):
//   - Mirrors the SSE route logic but runs fully async (no streaming)
//   - Updates project.metadata.generationStatus throughout so the GET
//     /generate endpoint can be polled for progress
//   - On success: persists generatedCode + audit log (identical to SSE path)
//   - On failure: marks generationStatus "failed", re-queues if retryable
// =============================================================================

import { prisma } from "@oneatlas/db";
import { createAuditLog } from "@oneatlas/db";
import { gateway } from "@oneatlas/ai";
import {
  dequeue,
  ack,
  failJob,
  promoteDelayedJobs,
  type Job,
  type JobType,
  type DeployJob,
  type AiGenerationJob,
} from "./client";
import { runDeployment } from "../deploymentService";
import { logger } from "../logger";

// ── AI generation system prompt (identical to the SSE route) ─────────────────

const AI_GENERATION_SYSTEM_PROMPT = `You are OneAtlas, an expert full-stack code generator.
Generate a complete, production-ready web application based on the user's prompt.

Respond ONLY with a JSON object matching this schema — no markdown, no explanation:
{
  "schema": { /* Prisma schema additions as string */ },
  "pages": [{ "path": string, "component": string, "description": string }],
  "apiRoutes": [{ "path": string, "method": string, "handler": string }],
  "metadata": { "title": string, "description": string, "techStack": string[] }
}`;

// ── Deploy worker ─────────────────────────────────────────────────────────────

async function handleDeployJob(job: DeployJob): Promise<void> {
  const { deploymentId, triggeredByUserId } = job.payload;

  const result = await runDeployment(deploymentId, triggeredByUserId);

  if (result.status === "FAILED") {
    throw new Error(result.error ?? "Deployment failed");
  }
}

// ── AI generation worker (fully wired) ───────────────────────────────────────

async function handleAiGenerationJob(job: AiGenerationJob): Promise<void> {
  const { projectId, orgId, prompt, projectType, triggeredByUserId } =
    job.payload;

  const log = logger.child({ jobId: job.id, projectId, orgId });

  // ── 1. Load project and guard ─────────────────────────────────────────────

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, status: true, metadata: true },
  });

  if (!project || project.status === "DELETED") {
    // Project gone — throw without retrying (failJob will dead-letter it)
    throw new Error(`Project ${projectId} not found or deleted`);
  }

  if (project.orgId !== orgId) {
    throw new Error(`Project ${projectId} does not belong to org ${orgId}`);
  }

  const meta = (project.metadata as Record<string, unknown>) ?? {};

  // Idempotency: if already done and this is a retry, skip without error
  if (meta.generationStatus === "done" && job.attempts > 1) {
    log.info("ai_generation.skipped.already_done", { attempts: job.attempts });
    return;
  }

  // ── 2. Mark as running ────────────────────────────────────────────────────

  await prisma.project.update({
    where: { id: projectId },
    data: {
      metadata: {
        ...(meta as object),
        generationStatus: "running",
        generationStartedAt: new Date().toISOString(),
        generationPrompt: prompt,
        generationJobId: job.id,
        generationAttempt: job.attempts,
      },
      status: "ACTIVE",
    },
  });

  log.info("ai_generation.started", { projectType, attempt: job.attempts });

  // ── 3. Call AI Gateway ────────────────────────────────────────────────────

  // Enrich prompt with project type context (mirrors the frontend prompt builder)
  const enrichedPrompt = projectType
    ? `Project type: ${projectType}\n\n${prompt}`
    : prompt;

  const aiResult = await gateway.completeJson<Record<string, unknown>>({
    tier: "smart",
    systemPrompt: AI_GENERATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: enrichedPrompt }],
    jsonMode: true,
    maxTokens: 8000,
    // Cache key: deterministic from project + prompt so retries get a cache hit
    cacheKey: `gen:${projectId}:${Buffer.from(prompt).toString("base64").slice(0, 32)}`,
    cacheTtl: 3600,
  });

  const generatedCode = aiResult.data;

  log.info("ai_generation.ai_complete", {
    provider: aiResult.provider,
    model: aiResult.model,
    cached: aiResult.cached,
    latencyMs: aiResult.latencyMs,
    pageCount: (generatedCode.pages as unknown[])?.length ?? 0,
  });

  // ── 4. Persist generated code ─────────────────────────────────────────────

  const generatedMeta =
    (generatedCode.metadata as Record<string, unknown>) ?? {};

  await prisma.project.update({
    where: { id: projectId },
    data: {
      generatedCode,
      prompt,
      metadata: {
        ...(meta as object),
        generationStatus: "done",
        generatedAt: new Date().toISOString(),
        generationPrompt: prompt,
        generationJobId: job.id,
        title: generatedMeta.title,
        description: generatedMeta.description,
      },
    },
  });

  // ── 5. Audit log ──────────────────────────────────────────────────────────

  await createAuditLog({
    orgId,
    userId: triggeredByUserId,
    projectId,
    action: "project.generation.completed",
    metadata: {
      jobId: job.id,
      model: aiResult.model,
      provider: aiResult.provider,
      cached: aiResult.cached,
      pageCount: (generatedCode.pages as unknown[])?.length ?? 0,
      apiRouteCount: (generatedCode.apiRoutes as unknown[])?.length ?? 0,
    },
  });

  log.info("ai_generation.done", { projectId });
}

// ── Best-effort: mark project as failed before rethrowing ─────────────────────

async function markGenerationFailed(
  job: AiGenerationJob,
  error: unknown
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : "Unknown error";

  try {
    const project = await prisma.project.findUnique({
      where: { id: job.payload.projectId },
      select: { metadata: true },
    });

    const meta = (project?.metadata as Record<string, unknown>) ?? {};

    await prisma.project.update({
      where: { id: job.payload.projectId },
      data: {
        metadata: {
          ...(meta as object),
          generationStatus: "failed",
          generationError: errorMessage,
          generationFailedAt: new Date().toISOString(),
          generationJobId: job.id,
        },
      },
    });
  } catch {
    // Best-effort — don't let cleanup failure hide the original error
  }
}

// ── Generic worker runner ─────────────────────────────────────────────────────

export interface WorkerRunResult {
  processed: number;
  succeeded: number;
  retried: number;
  dead: number;
  errors: string[];
}

/**
 * Pop and process up to `batchSize` jobs from a queue.
 * Returns a summary of what happened.
 */
export async function runWorker(
  type: JobType,
  batchSize = 5
): Promise<WorkerRunResult> {
  const result: WorkerRunResult = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    errors: [],
  };

  const log = logger.child({ queue: type });

  // Promote any delayed jobs whose backoff window has elapsed
  const promoted = await promoteDelayedJobs(type);
  if (promoted > 0) {
    log.info("worker.delayed.promoted", { count: promoted });
  }

  for (let i = 0; i < batchSize; i++) {
    const job = await dequeue(type);
    if (!job) break; // queue empty

    result.processed++;

    try {
      if (job.type === "deploy") {
        await handleDeployJob(job as DeployJob);
      } else if (job.type === "ai_generation") {
        await handleAiGenerationJob(job as AiGenerationJob);
      } else {
        throw new Error(`Unknown job type: ${(job as Job).type}`);
      }

      await ack(type, job);
      result.succeeded++;

      log.info("worker.job.succeeded", { jobId: job.id, type: job.type });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";

      result.errors.push(`[${job.id}] ${errorMessage}`);

      // Mark project failed before retry/dead-letter decision
      if (job.type === "ai_generation") {
        await markGenerationFailed(job as AiGenerationJob, err);
      }

      const outcome = await failJob(type, job, errorMessage);

      if (outcome === "retried") {
        result.retried++;
        log.warn("worker.job.retried", {
          jobId: job.id,
          type: job.type,
          attempt: job.attempts,
          error: errorMessage,
        });
      } else {
        result.dead++;
        log.error("worker.job.dead", {
          jobId: job.id,
          type: job.type,
          error: errorMessage,
        });
      }
    }
  }

  return result;
}
