// =============================================================================
// packages/db/src/seed.ts
// Development seed — creates a demo org, user, and project.
// Run: npm run db:seed (from packages/db)
// =============================================================================

import { prisma } from "./client";
import {
  OrgPlan,
  UserStatus,
  ProjectType,
  ProjectStatus,
  WorkflowStatus,
  TriggerType,
} from "@prisma/client";

async function main() {
  console.log("🌱 Seeding database...");

  // ── 1. Demo User ───────────────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { email: "demo@oneatlas.dev" },
    update: {},
    create: {
      clerkId: "user_seed_demo_001",
      email: "demo@oneatlas.dev",
      name: "Demo User",
      emailVerified: true,
      status: UserStatus.ACTIVE,
    },
  });
  console.log("✓ User created:", user.email);

  // ── 2. Demo Organization ───────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Corp",
      slug: "acme",
      plan: OrgPlan.PRO,
      ownerId: user.id,
      maxApps: 20,
      maxWorkflows: 50,
      maxMembers: 25,
    },
  });
  console.log("✓ Organization created:", org.name);

  // ── 3. Org Membership ─────────────────────────────────────────────────────
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: {
      orgId: org.id,
      userId: user.id,
      role: "OWNER",
      acceptedAt: new Date(),
    },
  });
  console.log("✓ OrgMember linked");

  // ── 4. Demo Project ────────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: { subdomain: "crm-acme" },
    update: {},
    create: {
      orgId: org.id,
      name: "CRM Dashboard",
      slug: "crm",
      description: "Customer relationship management with contacts, companies, and deal pipeline",
      type: ProjectType.CRUD_APP,
      status: ProjectStatus.ACTIVE,
      prompt: "Build a CRM with contacts, companies, and a deal pipeline with stages: Lead, Qualified, Proposal, Closing, Won, Lost",
      subdomain: "crm-acme",
      metadata: {
        tables: ["contacts", "companies", "deals", "stages"],
        pages: ["dashboard", "contacts", "companies", "pipeline"],
        aiModel: "gpt-4o-mini",
        generatedAt: new Date().toISOString(),
      },
    },
  });
  console.log("✓ Project created:", project.name);

  // ── 5. Project Env Vars ────────────────────────────────────────────────────
  await prisma.projectEnvVar.upsert({
    where: { projectId_key: { projectId: project.id, key: "APP_NAME" } },
    update: {},
    create: {
      projectId: project.id,
      key: "APP_NAME",
      value: "Acme CRM",
      isSecret: false,
    },
  });
  console.log("✓ Project env vars created");

  // ── 6. Demo Workflow ───────────────────────────────────────────────────────
  await prisma.workflow.upsert({
    where: { id: "seed_workflow_001" },
    update: {},
    create: {
      id: "seed_workflow_001",
      projectId: project.id,
      name: "New Deal Slack Notification",
      description: "Send a Slack message when a new deal is created",
      status: WorkflowStatus.ACTIVE,
      triggerType: TriggerType.DATABASE_EVENT,
      definition: {
        nodes: [
          {
            id: "trigger",
            type: "trigger",
            triggerType: "DATABASE_EVENT",
            config: { table: "deals", event: "INSERT" },
          },
          {
            id: "slack_notify",
            type: "action",
            provider: "SLACK",
            config: {
              channel: "#sales",
              message: "🎉 New deal created: {{deal.name}} — {{deal.value}}",
            },
          },
        ],
        edges: [{ from: "trigger", to: "slack_notify" }],
      },
    },
  });
  console.log("✓ Workflow created");

  // ── 7. Deployment ──────────────────────────────────────────────────────────
  await prisma.deployment.create({
    data: {
      projectId: project.id,
      version: 1,
      status: "LIVE",
      env: "PRODUCTION",
      cfWorkerName: "crm-acme-worker",
      deployedUrl: "https://crm-acme.oneatlas.app",
      buildDuration: 4200,
      deployedAt: new Date(),
    },
  });
  console.log("✓ Deployment created");

  console.log("\n✅ Seed complete!");
  console.log("   User:    demo@oneatlas.dev");
  console.log("   Org:     Acme Corp (slug: acme)");
  console.log("   App:     https://crm-acme.oneatlas.app");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
