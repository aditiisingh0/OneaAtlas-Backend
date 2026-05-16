// =============================================================================
// apps/api/src/lib/runtime.ts
//
// Runtime Engine — Row 15 (Dynamic Runtime)
//
// Responsibilities:
//   1. resolveSubdomain()    — map {slug}.oneatlas.app → Project + Org
//   2. loadRuntimeConfig()   — assemble the full runtime config for a project
//   3. validateRuntimeReady() — guard: ensure project is live before serving
//
// Used by:
//   - /api/v1/runtime/[subdomain]/route.ts   (public lookup endpoint)
//   - Future Cloudflare Worker proxy that needs the config at edge
// =============================================================================

import { prisma } from "@oneatlas/db";
import { NotFoundError, InternalError } from "@oneatlas/shared";
import { APP_DOMAIN } from "@oneatlas/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RuntimePage {
  path: string;
  component: string;
  description: string;
}

export interface RuntimeApiRoute {
  path: string;
  method: string;
  handler: string;
}

export interface RuntimeConfig {
  // Identity
  projectId: string;
  projectSlug: string;
  projectName: string;
  subdomain: string;
  deployedUrl: string;

  // Org
  orgId: string;
  orgSlug: string;
  orgName: string;
  orgPlan: string;

  // App shape (from generatedCode)
  pages: RuntimePage[];
  apiRoutes: RuntimeApiRoute[];
  appTitle: string;
  appDescription: string;
  techStack: string[];

  // Active deployment snapshot
  deploymentId: string;
  deploymentVersion: number;
  deployedAt: string | null;

  // Env vars (non-secret keys only — values are never sent to client)
  publicEnvKeys: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip {slug}.oneatlas.app → slug
 * Accepts full hostname or bare slug.
 */
export function extractSubdomain(hostnameOrSlug: string): string {
  const withoutPort = hostnameOrSlug.split(":")[0];
  if (withoutPort.endsWith(`.${APP_DOMAIN}`)) {
    return withoutPort.slice(0, -(APP_DOMAIN.length + 1));
  }
  return withoutPort; // already a bare slug
}

// ── Core: resolve subdomain → project ────────────────────────────────────────

export async function resolveSubdomain(subdomain: string) {
  const slug = extractSubdomain(subdomain).toLowerCase().trim();

  if (!slug) throw new NotFoundError("Subdomain");

  const project = await prisma.project.findUnique({
    where: { subdomain: slug },
    select: {
      id: true,
      slug: true,
      name: true,
      subdomain: true,
      status: true,
      generatedCode: true,
      metadata: true,
      orgId: true,
      org: {
        select: {
          id: true,
          slug: true,
          name: true,
          plan: true,
          status: true,
        },
      },
      deployments: {
        where: { status: "LIVE" },
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          deployedUrl: true,
          deployedAt: true,
          cfWorkerName: true,
        },
      },
      envVars: {
        select: { key: true, isSecret: true },
      },
    },
  });

  if (!project) throw new NotFoundError("App");
  if (project.status === "DELETED") throw new NotFoundError("App");
  if (project.org.status !== "ACTIVE") {
    throw new InternalError("Organisation is not active");
  }

  return project;
}

// ── Core: build RuntimeConfig ─────────────────────────────────────────────────

export async function loadRuntimeConfig(
  subdomain: string
): Promise<RuntimeConfig> {
  const project = await resolveSubdomain(subdomain);

  const liveDeployment = project.deployments[0] ?? null;

  if (!liveDeployment) {
    throw new NotFoundError(
      "No live deployment found. Deploy the project first."
    );
  }

  const generated = (project.generatedCode ?? {}) as Record<string, unknown>;
  const meta = (project.metadata ?? {}) as Record<string, unknown>;

  const pages: RuntimePage[] = Array.isArray(generated.pages)
    ? (generated.pages as RuntimePage[])
    : [];

  const apiRoutes: RuntimeApiRoute[] = Array.isArray(generated.apiRoutes)
    ? (generated.apiRoutes as RuntimeApiRoute[])
    : [];

  const appMeta = (generated.metadata ?? {}) as Record<string, unknown>;

  // Only expose non-secret env var keys (never values)
  const publicEnvKeys = project.envVars
    .filter((e) => !e.isSecret)
    .map((e) => e.key);

  return {
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    subdomain: project.subdomain,
    deployedUrl:
      liveDeployment.deployedUrl ??
      `https://${project.subdomain}.${APP_DOMAIN}`,

    orgId: project.org.id,
    orgSlug: project.org.slug,
    orgName: project.org.name,
    orgPlan: project.org.plan,

    pages,
    apiRoutes,
    appTitle: (appMeta.title as string) ?? (meta.title as string) ?? project.name,
    appDescription:
      (appMeta.description as string) ??
      (meta.description as string) ??
      "",
    techStack: Array.isArray(appMeta.techStack)
      ? (appMeta.techStack as string[])
      : [],

    deploymentId: liveDeployment.id,
    deploymentVersion: liveDeployment.version,
    deployedAt: liveDeployment.deployedAt?.toISOString() ?? null,

    publicEnvKeys,
  };
}

// ── Guard: validate project is ready to serve ─────────────────────────────────

export interface RuntimeReadiness {
  ready: boolean;
  reason?: string;
}

export async function validateRuntimeReady(
  subdomain: string
): Promise<RuntimeReadiness> {
  try {
    const project = await resolveSubdomain(subdomain);

    if (project.status === "ARCHIVED") {
      return { ready: false, reason: "Project is archived" };
    }

    if (!project.generatedCode) {
      return {
        ready: false,
        reason: "Project has no generated code. Run AI generation first.",
      };
    }

    const hasLiveDeployment = project.deployments.length > 0;
    if (!hasLiveDeployment) {
      return {
        ready: false,
        reason: "No live deployment. Trigger a deployment to go live.",
      };
    }

    return { ready: true };
  } catch {
    return { ready: false, reason: "App not found" };
  }
}
