// =============================================================================
// apps/api/src/lib/analytics.ts
//
// PostHog server-side analytics.
// Captures key product events for usage tracking and funnel analysis.
//
// Events captured:
//   - project.created
//   - generation.completed
//   - deployment.live
//
// Fire-and-forget: analytics must never block or crash a request.
// =============================================================================

import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY;
  if (!key) return null;

  if (!_client) {
    _client = new PostHog(key, {
      host: process.env.POSTHOG_HOST ?? "https://app.posthog.com",
      // Flush immediately in serverless — no persistent process to flush later
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return _client;
}

interface BaseEventProps {
  distinctId: string; // userId or orgId
  orgId?: string;
  projectId?: string;
}

// ── Event: project.created ────────────────────────────────────────────────────

export interface ProjectCreatedProps extends BaseEventProps {
  projectName: string;
  projectType: string;
  plan: string;
}

export function captureProjectCreated(props: ProjectCreatedProps): void {
  const ph = getClient();
  if (!ph) return;

  void ph
    .capture({
      distinctId: props.distinctId,
      event: "project.created",
      properties: {
        org_id:       props.orgId,
        project_id:   props.projectId,
        project_name: props.projectName,
        project_type: props.projectType,
        plan:         props.plan,
      },
    })
    .catch(() => {});
}

// ── Event: generation.completed ───────────────────────────────────────────────

export interface GenerationCompletedProps extends BaseEventProps {
  model: string;
  provider: string;
  cached: boolean;
  latencyMs: number;
  pageCount: number;
  apiRouteCount: number;
  tier: "fast" | "smart";
}

export function captureGenerationCompleted(props: GenerationCompletedProps): void {
  const ph = getClient();
  if (!ph) return;

  void ph
    .capture({
      distinctId: props.distinctId,
      event: "generation.completed",
      properties: {
        org_id:          props.orgId,
        project_id:      props.projectId,
        model:           props.model,
        provider:        props.provider,
        cached:          props.cached,
        latency_ms:      props.latencyMs,
        page_count:      props.pageCount,
        api_route_count: props.apiRouteCount,
        tier:            props.tier,
      },
    })
    .catch(() => {});
}

// ── Event: deployment.live ────────────────────────────────────────────────────

export interface DeploymentLiveProps extends BaseEventProps {
  deploymentId: string;
  deployedUrl: string;
  version: number;
  env: string;
}

export function captureDeploymentLive(props: DeploymentLiveProps): void {
  const ph = getClient();
  if (!ph) return;

  void ph
    .capture({
      distinctId: props.distinctId,
      event: "deployment.live",
      properties: {
        org_id:        props.orgId,
        project_id:    props.projectId,
        deployment_id: props.deploymentId,
        deployed_url:  props.deployedUrl,
        version:       props.version,
        env:           props.env,
      },
    })
    .catch(() => {});
}
