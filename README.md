# OneAtlas.dev — Backend & Infrastructure

AI-native internal tools platform. Serverless, multi-tenant, edge-first.

---

## Repository Structure

```
oneatlas/
├── apps/
│   └── api/                        # Next.js API server (App Router)
│       └── src/
│           ├── app/api/
│           │   ├── v1/
│           │   │   ├── me/
│           │   │   │   └── route.ts              # GET/PATCH current user profile
│           │   │   └── orgs/
│           │   │       ├── route.ts              # GET list orgs / POST create org
│           │   │       └── [orgId]/
│           │   │           ├── route.ts          # GET/PATCH org
│           │   │           ├── members/          # GET/POST/PATCH/DELETE members
│           │   │           └── projects/         # GET/POST projects
│           │   │               └── [projectId]/
│           │   │                   ├── route.ts          # GET/PATCH/DELETE project
│           │   │                   ├── generate/         # POST trigger AI gen (SSE) / GET status
│           │   │                   ├── deployments/      # GET list / POST trigger
│           │   │                   │   └── [deploymentId]/ # GET / POST rollback / DELETE undeploy
│           │   │                   └── workflows/        # GET list / POST create
│           │   │                       └── [workflowId]/ # GET / PATCH / DELETE
│           │   │                           └── run/      # GET run history / POST manual trigger
│           │   ├── webhooks/clerk/route.ts       # Clerk sync webhook
│           │   └── health/route.ts               # Health check
│           ├── lib/
│           │   ├── auth.ts                       # requireAuth, requireOrgMember, requireOrgAdmin
│           │   └── response.ts                   # ok, created, noContent, errorResponse
│           └── middleware.ts                     # Clerk auth + request logging + rate limiting
│
└── packages/
    ├── db/                         # @oneatlas/db — Prisma + Neon
    │   ├── prisma/
    │   │   ├── schema.prisma       # Full schema (all models + enums)
    │   │   └── migrations/         # Committed migration history
    │   │       └── 20260515090250_init/
    │   │           └── migration.sql
    │   └── src/
    │       ├── client.ts           # Singleton Prisma client
    │       ├── index.ts            # Package entry point
    │       ├── seed.ts             # Dev seed data
    │       └── helpers/
    │           ├── pagination.ts   # Offset + cursor pagination
    │           └── audit.ts        # createAuditLog()
    │
    └── shared/                     # @oneatlas/shared — no runtime deps (except zod)
        └── src/
            ├── constants.ts        # Plan limits, AI models, rate limits, slugs
            ├── errors.ts           # AppError + typed subclasses
            ├── utils.ts            # toSlug, generateApiKey, sha256, withRetry…
            ├── validators.ts       # Zod schemas for all API inputs
            └── index.ts
```

---

## Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Framework   | Next.js 14 (App Router)           |
| Language    | TypeScript (strict)               |
| Database    | PostgreSQL via Neon (serverless)  |
| ORM         | Prisma 5                          |
| Auth        | Clerk                             |
| Monorepo    | Turborepo                         |
| Hosting     | Cloudflare Pages + Workers        |
| Cache       | Upstash Redis                     |
| Storage     | Cloudflare R2                     |
| Rate Limit  | Upstash Ratelimit                 |

---

## Quick Start

### 1. Prerequisites

- Node.js ≥ 20
- npm ≥ 10

### 2. Clone & install

```bash
git clone https://github.com/aditiisingh0/OneaAtlas-Backend.git
cd oneatlas
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
# Fill in all values — see comments in .env.example
```

Required variables to get started:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | [neon.tech](https://neon.tech) → New Project → Connection string (pooled) |
| `DIRECT_URL` | Same page, select "Direct connection" |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | [dashboard.clerk.com](https://dashboard.clerk.com) |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys |
| `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks → Add endpoint |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `UPSTASH_REDIS_REST_URL` | [console.upstash.com](https://console.upstash.com) (optional in dev) |
| `UPSTASH_REDIS_REST_TOKEN` | Same page (optional in dev) |

### 4. Set up the database

```bash
# Generate Prisma client from schema
npm run db:generate

# Apply all committed migrations to your Neon database
npm run db:migrate

# (Optional) Seed with demo data
cd packages/db && npm run db:seed
```

> **Important:** Always use `prisma migrate deploy` (production) or `prisma migrate dev` (development) — never `prisma db push` on a shared database.

### 5. Start development

```bash
npm run dev
# API server starts at http://localhost:3001
```

---

## Database Models

### User
Synced from Clerk via webhook. One user can belong to many organizations.

### Organization
Multi-tenant root entity. Each org has a unique `slug` used for subdomains.
Plan limits are stored per-org and enforced at the API layer.

### OrgMember
Join table — `User ↔ Organization` with a `UserRole` (OWNER | ADMIN | MEMBER | VIEWER).

### Project
A generated app. Stores the original AI `prompt`, `metadata` (schema/pages config),
`generatedCode` (file tree JSON), and gets its own `subdomain`.

### Deployment
Each time a project is deployed to Cloudflare Workers, a new `Deployment` row is
created with an auto-incrementing `version`. Status flows:
`QUEUED → BUILDING → DEPLOYING → LIVE` (or `FAILED` / `ROLLED_BACK`).

### Workflow
Node-graph automation (triggers + actions + conditions). Stores the full
`definition` as JSON. Supports `SCHEDULE` (cron), `WEBHOOK`, `DATABASE_EVENT`,
and `MANUAL` triggers.

### WorkflowRun
Execution record per workflow invocation. Stores input/output data and a
step-by-step `trace` for debugging. Has `orgId` denormalized for fast tenant filtering.

### Integration
OAuth connection to an external service (Slack, Gmail, etc.) per org.
Tokens are stored encrypted.

### AuditLog
Append-only log of every significant action (project created, deployment triggered,
member removed, etc.). Never deleted.

---

## API Reference

All routes require a valid Clerk session except `GET /api/health` and `POST /api/webhooks/clerk`.

```
GET    /api/health
POST   /api/webhooks/clerk

# Profile
GET    /api/v1/me
PATCH  /api/v1/me

# Organisations
GET    /api/v1/orgs
POST   /api/v1/orgs
GET    /api/v1/orgs/:orgId
PATCH  /api/v1/orgs/:orgId

# Members
GET    /api/v1/orgs/:orgId/members
POST   /api/v1/orgs/:orgId/members
PATCH  /api/v1/orgs/:orgId/members/:memberId
DELETE /api/v1/orgs/:orgId/members/:memberId

# Projects
GET    /api/v1/orgs/:orgId/projects
POST   /api/v1/orgs/:orgId/projects
GET    /api/v1/orgs/:orgId/projects/:projectId
PATCH  /api/v1/orgs/:orgId/projects/:projectId
DELETE /api/v1/orgs/:orgId/projects/:projectId

# AI Generation (P0) — streams Server-Sent Events
POST   /api/v1/orgs/:orgId/projects/:projectId/generate
GET    /api/v1/orgs/:orgId/projects/:projectId/generate

# Deployments
GET    /api/v1/orgs/:orgId/projects/:projectId/deployments
POST   /api/v1/orgs/:orgId/projects/:projectId/deployments
GET    /api/v1/orgs/:orgId/projects/:projectId/deployments/:deploymentId
POST   /api/v1/orgs/:orgId/projects/:projectId/deployments/:deploymentId/rollback
DELETE /api/v1/orgs/:orgId/projects/:projectId/deployments/:deploymentId

# Workflows
GET    /api/v1/orgs/:orgId/projects/:projectId/workflows
POST   /api/v1/orgs/:orgId/projects/:projectId/workflows
GET    /api/v1/orgs/:orgId/projects/:projectId/workflows/:workflowId
PATCH  /api/v1/orgs/:orgId/projects/:projectId/workflows/:workflowId
DELETE /api/v1/orgs/:orgId/projects/:projectId/workflows/:workflowId
GET    /api/v1/orgs/:orgId/projects/:projectId/workflows/:workflowId/run
POST   /api/v1/orgs/:orgId/projects/:projectId/workflows/:workflowId/run
```

### SSE Generation Stream

The `POST /generate` endpoint returns a Server-Sent Events stream:

| Event | Payload |
|-------|---------|
| `status` | `{ step: string, message: string }` |
| `done` | `{ projectId, generatedAt, summary: { pages, apiRoutes } }` |
| `error` | `{ message: string }` |

### Response format

```ts
// Success
{ success: true, data: T }

// Paginated
{ success: true, data: { data: T[], pagination: { total, page, limit, totalPages, hasNext, hasPrev } } }

// Error
{ success: false, error: { code: ErrorCode, message: string, status: number, details?: unknown } }
```

---

## Middleware

Every request goes through `middleware.ts` which handles:

**Authentication** — Clerk session validation. Public routes (`/api/health`, `/api/webhooks/*`) bypass auth.

**Request Logging** — Every request emits a structured JSON log line:
```json
{ "ts": "...", "requestId": "uuid", "clerkUserId": "...", "orgId": "...", "method": "POST", "path": "...", "latencyMs": 12 }
```

**Rate Limiting** — Enforced per `userId:orgId` via Upstash Redis:

| Route | Limit |
|-------|-------|
| Default | 60 req/min |
| `/generate` | 10 req/min |
| `/deployments` (POST) | 5 req/min |

Rate limiting is silently skipped in dev if `UPSTASH_REDIS_REST_URL` is not set.
Returns `429` with `Retry-After` header when limit is exceeded.

> **Required dependency:** `pnpm add @upstash/ratelimit @upstash/redis --filter @oneatlas/api`

---

## Scripts

```bash
# Root (runs across all apps/packages via Turborepo)
npm run dev          # Start all dev servers in parallel
npm run build        # Build everything
npm run type-check   # TypeScript check all packages
npm run lint         # ESLint all packages

# Database (run from root or packages/db)
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Create + apply a new migration (dev)
npm run db:push      # Push schema without migration file (prototyping only — never on shared DB)
npm run db:studio    # Open Prisma Studio at localhost:5555
cd packages/db && npm run db:seed   # Seed demo data
```

---

## Adding a New Route

1. Create file at `apps/api/src/app/api/v1/.../route.ts`
2. Add Zod schema to `packages/shared/src/validators.ts`
3. Call `requireOrgMember(orgId)` at the top for auth
4. Return with `ok()` / `created()` / `errorResponse()`
5. Add `createAuditLog()` after any mutating operation

Example skeleton:

```ts
import { NextRequest } from "next/server";
import { prisma } from "@oneatlas/db";
import { mySchema } from "@oneatlas/shared";
import { requireOrgMember } from "../../lib/auth";
import { ok, created, errorResponse } from "../../lib/response";
import { createAuditLog } from "@oneatlas/db";

export async function POST(req: NextRequest, { params }: { params: { orgId: string } }) {
  try {
    const auth = await requireOrgMember(params.orgId, "MEMBER");
    const body = mySchema.parse(await req.json());

    const result = await prisma.myModel.create({ data: { ...body } });

    await createAuditLog({
      orgId: params.orgId,
      userId: auth.userId,
      action: "myModel.created",
      metadata: { id: result.id },
    });

    return created(result);
  } catch (error) {
    return errorResponse(error);
  }
}
```

---

## What's Still TODO

These are stubs left in the code — not yet wired up:

| Item | File | Notes |
|------|------|-------|
| Job queue for deployments | `deployments/route.ts` | Wire up BullMQ or Cloudflare Queue |
| Job queue for workflow runs | `workflows/[workflowId]/run/route.ts` | Same queue |
| Cloudflare Workers deploy | `deployments/[deploymentId]/route.ts` | Implement using `@cloudflare/workers-sdk` |
| Log shipping | `middleware.ts` | Add `@logtail/node` + `BETTERSTACK_SOURCE_TOKEN` |

---

## Environment Notes

- `DATABASE_URL` must use the **pooled** Neon connection string (pgBouncer) for API routes
- `DIRECT_URL` must use the **direct** connection string for Prisma migrations
- Never commit `.env` — use Vercel/Cloudflare environment variable dashboards for production
- `UPSTASH_REDIS_REST_URL` is optional in dev — rate limiting silently skips if absent