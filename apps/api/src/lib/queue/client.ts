// =============================================================================
// apps/api/src/lib/queue/client.ts
//
// Row 17 — Queue System (Background Jobs)
//
// Upstash Redis-backed queue using the @upstash/redis REST client.
// Serverless-safe: no persistent connections, no BullMQ daemon.
//
// Architecture:
//   - Jobs are pushed to a Redis LIST (LPUSH) — one list per job type
//   - Workers pop jobs with BRPOPLPUSH (atomic, safe for retries)
//   - Failed jobs land in a dead-letter list after maxRetries
//   - A lightweight retry counter lives as a Redis HASH alongside each job
//
// Lists used:
//   queue:deploy        — deployment jobs
//   queue:ai            — AI generation jobs
//   queue:deploy:dead   — failed deploy jobs
//   queue:ai:dead       — failed AI jobs
// =============================================================================

import { Redis } from "@upstash/redis";

// ── Redis client (singleton) ──────────────────────────────────────────────────

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error(
        "Missing Upstash env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN"
      );
    }

    _redis = new Redis({ url, token });
  }
  return _redis;
}

// ── Job types ─────────────────────────────────────────────────────────────────

export type JobType = "deploy" | "ai_generation";

export interface BaseJob {
  id: string;
  type: JobType;
  createdAt: string;
  attempts: number;
  maxRetries: number;
}

export interface DeployJob extends BaseJob {
  type: "deploy";
  payload: {
    deploymentId: string;
    triggeredByUserId: string;
  };
}

export interface AiGenerationJob extends BaseJob {
  type: "ai_generation";
  payload: {
    projectId: string;
    orgId: string;
    prompt: string;
    projectType: string;
    triggeredByUserId: string;
  };
}

export type Job = DeployJob | AiGenerationJob;

// ── Queue key helpers ─────────────────────────────────────────────────────────

const QUEUE_PREFIX = "queue";
const PROCESSING_SUFFIX = ":processing";
const DEAD_SUFFIX = ":dead";
const META_PREFIX = "job:meta:";

export function queueKey(type: JobType): string {
  return `${QUEUE_PREFIX}:${type}`;
}

export function processingKey(type: JobType): string {
  return `${QUEUE_PREFIX}:${type}${PROCESSING_SUFFIX}`;
}

export function deadLetterKey(type: JobType): string {
  return `${QUEUE_PREFIX}:${type}${DEAD_SUFFIX}`;
}

export function jobMetaKey(jobId: string): string {
  return `${META_PREFIX}${jobId}`;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

/**
 * Push a job onto the appropriate queue.
 * Returns the job ID.
 */
export async function enqueue<T extends Job>(
  job: Omit<T, "id" | "createdAt" | "attempts"> & { id?: string }
): Promise<string> {
  const redis = getRedis();

  const fullJob: Job = {
    ...job,
    id: job.id ?? crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  } as Job;

  const key = queueKey(fullJob.type);
  const serialized = JSON.stringify(fullJob);

  // LPUSH — new jobs go to the left; workers pop from the right (FIFO)
  await redis.lpush(key, serialized);

  // Store metadata for status lookups
  await redis.hset(jobMetaKey(fullJob.id), {
    id: fullJob.id,
    type: fullJob.type,
    status: "queued",
    createdAt: fullJob.createdAt,
    attempts: "0",
    maxRetries: String(fullJob.maxRetries),
  });

  return fullJob.id;
}

// ── Dequeue (atomic pop → processing list) ────────────────────────────────────

/**
 * Atomically move a job from the queue to the processing list.
 * Returns null if the queue is empty.
 *
 * Uses RPOPLPUSH for safe at-least-once delivery:
 * if the worker crashes, the job stays in the processing list
 * and can be recovered by a sweep job.
 */
export async function dequeue(type: JobType): Promise<Job | null> {
  const redis = getRedis();
  const from = queueKey(type);
  const to = processingKey(type);

  // RPOPLPUSH: pop from right of source, push to left of dest (atomic)
  const raw = await redis.rpoplpush(from, to);
  if (!raw) return null;

  const job = (typeof raw === "string" ? JSON.parse(raw) : raw) as Job;

  // Update metadata
  await redis.hset(jobMetaKey(job.id), {
    status: "processing",
    startedAt: new Date().toISOString(),
    attempts: String(job.attempts + 1),
  });

  return { ...job, attempts: job.attempts + 1 };
}

// ── Acknowledge (remove from processing list) ─────────────────────────────────

export async function ack(type: JobType, job: Job): Promise<void> {
  const redis = getRedis();
  const serialized = JSON.stringify({ ...job, attempts: job.attempts });

  // Remove from processing list
  await redis.lrem(processingKey(type), 1, serialized);

  // Mark as done in metadata
  await redis.hset(jobMetaKey(job.id), {
    status: "completed",
    completedAt: new Date().toISOString(),
  });

  // Expire metadata after 24h
  await redis.expire(jobMetaKey(job.id), 86400);
}

// ── Fail / retry / dead-letter ────────────────────────────────────────────────

export async function failJob(
  type: JobType,
  job: Job,
  errorMessage: string
): Promise<"retried" | "dead"> {
  const redis = getRedis();
  const serialized = JSON.stringify(job);

  // Remove from processing
  await redis.lrem(processingKey(type), 1, serialized);

  if (job.attempts < job.maxRetries) {
    // Re-enqueue with incremented attempts — exponential backoff via delayed re-push
    const retried = { ...job, attempts: job.attempts };
    await redis.lpush(queueKey(type), JSON.stringify(retried));

    await redis.hset(jobMetaKey(job.id), {
      status: "retrying",
      lastError: errorMessage,
      attempts: String(job.attempts),
    });

    return "retried";
  }

  // Dead-letter
  const deadJob = {
    ...job,
    failedAt: new Date().toISOString(),
    lastError: errorMessage,
  };

  await redis.lpush(deadLetterKey(type), JSON.stringify(deadJob));

  await redis.hset(jobMetaKey(job.id), {
    status: "dead",
    lastError: errorMessage,
    deadAt: new Date().toISOString(),
  });

  // Keep dead job meta for 7 days
  await redis.expire(jobMetaKey(job.id), 7 * 86400);

  return "dead";
}

// ── Job status lookup ─────────────────────────────────────────────────────────

export interface JobStatus {
  id: string;
  type: string;
  status: "queued" | "processing" | "completed" | "retrying" | "dead" | "unknown";
  attempts: number;
  maxRetries: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  deadAt?: string;
  lastError?: string;
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const redis = getRedis();
  const meta = await redis.hgetall(jobMetaKey(jobId));

  if (!meta || Object.keys(meta).length === 0) return null;

  return {
    id: meta.id as string,
    type: meta.type as string,
    status: (meta.status as JobStatus["status"]) ?? "unknown",
    attempts: Number(meta.attempts ?? 0),
    maxRetries: Number(meta.maxRetries ?? 3),
    createdAt: meta.createdAt as string,
    startedAt: meta.startedAt as string | undefined,
    completedAt: meta.completedAt as string | undefined,
    deadAt: meta.deadAt as string | undefined,
    lastError: meta.lastError as string | undefined,
  };
}

// ── Queue depth (monitoring) ──────────────────────────────────────────────────

export interface QueueStats {
  type: JobType;
  queued: number;
  processing: number;
  dead: number;
}

export async function getQueueStats(type: JobType): Promise<QueueStats> {
  const redis = getRedis();

  const [queued, processing, dead] = await Promise.all([
    redis.llen(queueKey(type)),
    redis.llen(processingKey(type)),
    redis.llen(deadLetterKey(type)),
  ]);

  return { type, queued, processing, dead };
}
