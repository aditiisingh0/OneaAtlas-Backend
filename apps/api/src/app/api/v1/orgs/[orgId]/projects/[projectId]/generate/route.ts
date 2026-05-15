// =============================================================================
// apps/api/src/app/api/v1/orgs/[orgId]/projects/[projectId]/generate/route.ts
//
// POST /api/v1/orgs/:orgId/projects/:projectId/generate
//   Triggers AI code generation for a project.
//   Streams progress back to the client via Server-Sent Events (SSE).
//
// GET  /api/v1/orgs/:orgId/projects/:projectId/generate
//   Returns the current generation status (for polling fallback).
// =============================================================================

import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { z } from "zod";
import {
  NotFoundError,
  ConflictError,
  AI_MODELS,
  RATE_LIMITS,
} from "@oneatlas/shared";
import { requireOrgMember } from "../../../../../../../../../lib/auth";
import { errorResponse, ok } from "../../../../../../../../../lib/response";
import { createAuditLog } from "@oneatlas/db";

interface RouteContext {
  params: { orgId: string; projectId: string };
}

const generateSchema = z.object({
  prompt: z.string().min(10).max(8000),
  model: z.enum(["FAST", "SMART"]).default("SMART"),
  // Optionally regenerate only specific parts
  regenerateParts: z
    .array(z.enum(["schema", "pages", "api", "workflows", "all"]))
    .default(["all"]),
});

// ── GET — check generation status ────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireOrgMember(params.orgId);

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        id: true,
        orgId: true,
        status: true,
        metadata: true,
        generatedCode: true,
        updatedAt: true,
      },
    });

    if (!project || project.orgId !== params.orgId) {
      throw new NotFoundError("Project");
    }

    const meta = (project.metadata as Record<string, unknown>) ?? {};

    return ok({
      projectId: project.id,
      status: project.status,
      generationStatus: meta.generationStatus ?? "idle",
      generatedAt: meta.generatedAt ?? null,
      hasCode: !!project.generatedCode,
      lastUpdated: project.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ── POST — trigger AI generation (SSE stream) ─────────────────────────────────
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const body = generateSchema.parse(await req.json());

    // Verify project
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, orgId: true, status: true, metadata: true },
    });

    if (!project || project.orgId !== params.orgId) {
      throw new NotFoundError("Project");
    }

    if (project.status === "DELETED") {
      throw new NotFoundError("Project");
    }

    // Guard: only one generation at a time
    const meta = (project.metadata as Record<string, unknown>) ?? {};
    if (meta.generationStatus === "running") {
      throw new ConflictError(
        "Generation is already in progress for this project."
      );
    }

    // Mark as running before streaming starts
    await prisma.project.update({
      where: { id: params.projectId },
      data: {
        metadata: {
          ...(meta as object),
          generationStatus: "running",
          generationStartedAt: new Date().toISOString(),
          generationPrompt: body.prompt,
        },
        status: "ACTIVE",
      },
    });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      projectId: params.projectId,
      action: "project.generation.started",
      metadata: { model: body.model, parts: body.regenerateParts },
    });

    // ── Build the SSE stream ─────────────────────────────────────────────────
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        };

        try {
          send("status", { step: "init", message: "Starting AI generation…" });

          // ── Call Anthropic (streaming) ──────────────────────────────────────
          const model =
            body.model === "FAST"
              ? AI_MODELS.FAST.anthropic
              : AI_MODELS.SMART.anthropic;

          const systemPrompt = `You are OneAtlas, an expert full-stack code generator.
Generate a complete, production-ready web application based on the user's prompt.

Respond ONLY with a JSON object matching this schema — no markdown, no explanation:
{
  "schema": { /* Prisma schema additions as string */ },
  "pages": [{ "path": string, "component": string, "description": string }],
  "apiRoutes": [{ "path": string, "method": string, "handler": string }],
  "metadata": { "title": string, "description": string, "techStack": string[] }
}`;

          send("status", { step: "ai", message: "Calling AI model…" });

          const aiResponse = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model,
                max_tokens: 8000,
                system: systemPrompt,
                messages: [{ role: "user", content: body.prompt }],
              }),
            }
          );

          if (!aiResponse.ok) {
            const err = await aiResponse.text();
            throw new Error(`AI API error: ${aiResponse.status} — ${err}`);
          }

          const aiData = await aiResponse.json();
          const rawContent = aiData.content?.[0]?.text ?? "{}";

          send("status", { step: "parsing", message: "Parsing generated code…" });

          let generatedCode: Record<string, unknown>;
          try {
            const clean = rawContent
              .replace(/```json\n?/g, "")
              .replace(/```\n?/g, "")
              .trim();
            generatedCode = JSON.parse(clean);
          } catch {
            throw new Error("AI returned malformed JSON. Try again.");
          }

          send("status", { step: "saving", message: "Saving to database…" });

          // Persist generated code
          await prisma.project.update({
            where: { id: params.projectId },
            data: {
              generatedCode,
              prompt: body.prompt,
              metadata: {
                ...(meta as object),
                generationStatus: "done",
                generatedAt: new Date().toISOString(),
                generationPrompt: body.prompt,
                title: (generatedCode.metadata as Record<string, unknown>)
                  ?.title,
                description: (
                  generatedCode.metadata as Record<string, unknown>
                )?.description,
              },
            },
          });

          await createAuditLog({
            orgId: params.orgId,
            userId: auth.userId,
            projectId: params.projectId,
            action: "project.generation.completed",
            metadata: {
              model,
              pageCount: (
                generatedCode.pages as unknown[]
              )?.length ?? 0,
            },
          });

          send("done", {
            projectId: params.projectId,
            generatedAt: new Date().toISOString(),
            summary: {
              pages: (generatedCode.pages as unknown[])?.length ?? 0,
              apiRoutes: (generatedCode.apiRoutes as unknown[])?.length ?? 0,
            },
          });
        } catch (err) {
          // Mark generation as failed
          await prisma.project.update({
            where: { id: params.projectId },
            data: {
              metadata: {
                ...(meta as object),
                generationStatus: "failed",
                generationError:
                  err instanceof Error ? err.message : "Unknown error",
              },
            },
          });

          send("error", {
            message: err instanceof Error ? err.message : "Generation failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable Nginx buffering
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
