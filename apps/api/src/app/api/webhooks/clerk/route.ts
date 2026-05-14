// =============================================================================
// apps/api/src/app/api/webhooks/clerk/route.ts
// Clerk webhook — keeps our DB in sync with Clerk auth events.
// Events handled: user.created, user.updated, user.deleted,
//                 organizationMembership.created, organizationMembership.deleted
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { prisma } from "@oneatlas/db";
import { HTTP_STATUS } from "@oneatlas/shared";

type ClerkWebhookEvent =
  | { type: "user.created"; data: ClerkUser }
  | { type: "user.updated"; data: ClerkUser }
  | { type: "user.deleted"; data: { id: string } }
  | { type: "organizationMembership.created"; data: ClerkOrgMembership }
  | { type: "organizationMembership.deleted"; data: ClerkOrgMembership };

interface ClerkUser {
  id: string;
  email_addresses: { email_address: string; verification: { status: string } }[];
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
}

interface ClerkOrgMembership {
  public_user_data: { user_id: string };
  organization: { id: string };
  role: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Webhook] CLERK_WEBHOOK_SECRET not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }

  // Verify signature
  const svix = new Webhook(secret);
  const body = await req.text();
  let event: ClerkWebhookEvent;

  try {
    event = svix.verify(body, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: HTTP_STATUS.UNAUTHORIZED }
    );
  }

  try {
    switch (event.type) {
      case "user.created":
        await handleUserCreated(event.data);
        break;
      case "user.updated":
        await handleUserUpdated(event.data);
        break;
      case "user.deleted":
        await handleUserDeleted(event.data.id);
        break;
      case "organizationMembership.created":
        await handleMembershipCreated(event.data);
        break;
      case "organizationMembership.deleted":
        await handleMembershipDeleted(event.data);
        break;
      default:
        // Ignore unhandled events
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleUserCreated(data: ClerkUser) {
  const primaryEmail = data.email_addresses[0];
  if (!primaryEmail) return;

  await prisma.user.upsert({
    where: { clerkId: data.id },
    update: {},
    create: {
      clerkId: data.id,
      email: primaryEmail.email_address,
      emailVerified: primaryEmail.verification?.status === "verified",
      name: [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
      avatarUrl: data.image_url,
      status: "ACTIVE",
    },
  });

  console.log(`[Webhook] user.created → ${primaryEmail.email_address}`);
}

async function handleUserUpdated(data: ClerkUser) {
  const primaryEmail = data.email_addresses[0];
  if (!primaryEmail) return;

  await prisma.user.update({
    where: { clerkId: data.id },
    data: {
      email: primaryEmail.email_address,
      emailVerified: primaryEmail.verification?.status === "verified",
      name: [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
      avatarUrl: data.image_url,
    },
  });

  console.log(`[Webhook] user.updated → ${data.id}`);
}

async function handleUserDeleted(clerkId: string) {
  await prisma.user.updateMany({
    where: { clerkId },
    data: { status: "INACTIVE" },
  });

  console.log(`[Webhook] user.deleted → ${clerkId}`);
}

async function handleMembershipCreated(data: ClerkOrgMembership) {
  const user = await prisma.user.findUnique({
    where: { clerkId: data.public_user_data.user_id },
    select: { id: true },
  });

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: data.organization.id },
    select: { id: true },
  });

  if (!user || !org) return;

  const role = clerkRoleToDbRole(data.role);

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: { role },
    create: {
      orgId: org.id,
      userId: user.id,
      role,
      acceptedAt: new Date(),
    },
  });
}

async function handleMembershipDeleted(data: ClerkOrgMembership) {
  const user = await prisma.user.findUnique({
    where: { clerkId: data.public_user_data.user_id },
    select: { id: true },
  });

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: data.organization.id },
    select: { id: true },
  });

  if (!user || !org) return;

  await prisma.orgMember.deleteMany({
    where: { orgId: org.id, userId: user.id },
  });
}

function clerkRoleToDbRole(clerkRole: string) {
  const map: Record<string, "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"> = {
    "org:admin": "ADMIN",
    "org:member": "MEMBER",
    "org:viewer": "VIEWER",
  };
  return map[clerkRole] ?? "MEMBER";
}
