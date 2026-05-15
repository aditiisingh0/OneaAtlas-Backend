# Schema Patch — Missing Indexes (Fix #3)

Apply these two changes to `packages/db/prisma/schema.prisma`:

## WorkflowRun — add `@@index([orgId])` and orgId field

WorkflowRun has no `orgId` column, so multi-tenant filtering goes through a
join to Workflow → Project → Organization. That's two extra joins per query.
Add `orgId` as a **denormalized** column and index it for fast per-org lookups.

```prisma
model WorkflowRun {
  id         String            @id @default(cuid())
  workflowId String
  orgId      String            // ← ADD: denormalized for fast tenant filtering
  status     WorkflowRunStatus @default(PENDING)

  trace      Json    @default("[]")
  inputData  Json?
  outputData Json?

  errorMessage String? @db.Text
  duration     Int?

  startedAt  DateTime?
  finishedAt DateTime?
  createdAt  DateTime  @default(now())

  workflow Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  @@index([workflowId])
  @@index([orgId])          // ← ADD
  @@index([status])
  @@index([orgId, status])  // ← ADD: composite for "show org's failed runs"
  @@map("workflow_runs")
}
```

## AuditLog — add composite index

`AuditLog` already has `@@index([orgId])` but filtering by org + time range
(the most common audit query) requires a **composite** index to avoid a sort:

```prisma
  @@index([orgId])
  @@index([userId])
  @@index([createdAt])
  @@index([orgId, createdAt(sort: Desc)])  // ← ADD: org audit feed, paginated
```

After editing, run:
```bash
npx prisma migrate dev --name add_org_indexes
```
