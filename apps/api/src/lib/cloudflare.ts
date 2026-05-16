// =============================================================================
// apps/api/src/lib/cloudflare.ts
//
// Row 16 — Deployment System (Cloudflare Deployments)
//
// Wraps the Cloudflare REST API for:
//   1. deployWorker()    — upload a generated app as a Cloudflare Worker
//   2. deleteWorker()    — remove a worker (undeploy)
//   3. addDnsRecord()    — create CNAME {slug}.oneatlas.app → worker route
//   4. removeDnsRecord() — clean up DNS on undeploy
//   5. getWorkerStatus() — check if a worker is live
//
// All functions are pure — they do not touch the DB.
// The caller (deploymentService.ts) handles DB writes and audit logs.
// =============================================================================

// ── Config ────────────────────────────────────────────────────────────────────

function cfConfig() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (!token || !accountId || !zoneId) {
    throw new Error(
      "Missing Cloudflare env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID"
    );
  }

  return { token, accountId, zoneId };
}

const CF_BASE = "https://api.cloudflare.com/client/v4";
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "oneatlas.app";

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function cfFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { token } = cfConfig();

  const res = await fetch(`${CF_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const json = (await res.json()) as { success: boolean; result: T; errors: { message: string }[] };

  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? "Cloudflare API error";
    throw new Error(`CF API ${res.status}: ${msg}`);
  }

  return json.result;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeployWorkerInput {
  /** Unique worker name — e.g. "oneatlas-myapp-prod-v3" */
  workerName: string;
  /** The generated Worker script content (JS string) */
  script: string;
  /** KV namespace bindings if the app needs storage */
  kvNamespaces?: { binding: string; id: string }[];
  /** Plain-text env vars to bind (non-secret) */
  plainTextBindings?: { name: string; text: string }[];
}

export interface DeployWorkerResult {
  workerName: string;
  deployedUrl: string;
  cfDeploymentId: string;
}

export interface WorkerStatus {
  exists: boolean;
  workerName: string;
  deployedUrl?: string;
  modifiedOn?: string;
}

// ── 1. Deploy a Worker ────────────────────────────────────────────────────────

/**
 * Upload a Cloudflare Worker script for a generated app.
 * Uses multipart form (workers.dev API v4).
 */
export async function deployWorker(
  input: DeployWorkerInput
): Promise<DeployWorkerResult> {
  const { accountId } = cfConfig();

  // Build the metadata part
  const metadata: Record<string, unknown> = {
    main_module: "worker.js",
    compatibility_date: new Date().toISOString().slice(0, 10),
    bindings: [] as unknown[],
  };

  const bindings: unknown[] = [];

  if (input.kvNamespaces) {
    for (const kv of input.kvNamespaces) {
      bindings.push({ type: "kv_namespace", name: kv.binding, namespace_id: kv.id });
    }
  }

  if (input.plainTextBindings) {
    for (const env of input.plainTextBindings) {
      bindings.push({ type: "plain_text", name: env.name, text: env.text });
    }
  }

  metadata.bindings = bindings;

  // Multipart upload
  const formData = new FormData();
  formData.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  formData.append(
    "worker.js",
    new Blob([input.script], { type: "application/javascript+module" }),
    "worker.js"
  );

  const { token } = cfConfig();

  const res = await fetch(
    `${CF_BASE}/accounts/${accountId}/workers/scripts/${input.workerName}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }
  );

  const json = (await res.json()) as {
    success: boolean;
    result: { id: string; etag: string };
    errors: { message: string }[];
  };

  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? "Worker upload failed";
    throw new Error(`CF Deploy ${res.status}: ${msg}`);
  }

  return {
    workerName: input.workerName,
    deployedUrl: `https://${input.workerName}.${accountId}.workers.dev`,
    cfDeploymentId: json.result?.etag ?? crypto.randomUUID(),
  };
}

// ── 2. Delete a Worker ────────────────────────────────────────────────────────

export async function deleteWorker(workerName: string): Promise<void> {
  const { accountId } = cfConfig();
  await cfFetch(`/accounts/${accountId}/workers/scripts/${workerName}`, {
    method: "DELETE",
  });
}

// ── 3. Add DNS CNAME record ───────────────────────────────────────────────────

export interface DnsRecord {
  id: string;
  name: string;
  content: string;
  type: string;
}

/**
 * Create a CNAME: {slug}.oneatlas.app → {workerRoute}
 * If a record already exists for this subdomain, it is updated.
 */
export async function addDnsRecord(
  subdomain: string,
  workerName: string
): Promise<DnsRecord> {
  const { zoneId, accountId } = cfConfig();

  const fqdn = `${subdomain}.${APP_DOMAIN}`;
  const target = `${workerName}.${accountId}.workers.dev`;

  // Check for existing record
  const existing = await cfFetch<DnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=CNAME&name=${fqdn}`
  );

  if (Array.isArray(existing) && existing.length > 0) {
    // Update existing
    const record = existing[0];
    return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: target }),
    });
  }

  // Create new
  return cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "CNAME",
      name: fqdn,
      content: target,
      ttl: 1, // automatic
      proxied: true, // route through Cloudflare proxy
    }),
  });
}

// ── 4. Remove DNS record ──────────────────────────────────────────────────────

export async function removeDnsRecord(subdomain: string): Promise<void> {
  const { zoneId } = cfConfig();

  const fqdn = `${subdomain}.${APP_DOMAIN}`;
  const records = await cfFetch<DnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=CNAME&name=${fqdn}`
  );

  if (!Array.isArray(records) || records.length === 0) return;

  await cfFetch(`/zones/${zoneId}/dns_records/${records[0].id}`, {
    method: "DELETE",
  });
}

// ── 5. Get Worker status ──────────────────────────────────────────────────────

export async function getWorkerStatus(workerName: string): Promise<WorkerStatus> {
  const { accountId } = cfConfig();

  try {
    const result = await cfFetch<{ id: string; modified_on: string }>(
      `/accounts/${accountId}/workers/scripts/${workerName}`
    );

    return {
      exists: true,
      workerName,
      deployedUrl: `https://${workerName}.${accountId}.workers.dev`,
      modifiedOn: result?.modified_on,
    };
  } catch {
    return { exists: false, workerName };
  }
}

// ── 6. Build worker name ──────────────────────────────────────────────────────

/**
 * Deterministic worker name from project slug + env + version.
 * e.g. "oa-myapp-prod-v3"
 * Max 63 chars (Cloudflare limit).
 */
export function buildWorkerName(
  projectSlug: string,
  env: "PREVIEW" | "PRODUCTION",
  version: number
): string {
  const envTag = env === "PREVIEW" ? "prev" : "prod";
  const name = `oa-${projectSlug}-${envTag}-v${version}`;
  return name.slice(0, 63).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
