// =============================================================================
// packages/ai/src/gateway.ts
//
// Row 20 — AI Gateway: Core Orchestrator
//
// The single entry point for all AI completions across OneAtlas.
// Responsibilities:
//   1. Cache check  — serve from Redis if cacheKey supplied
//   2. Provider selection — pick primary, fallback on failure
//   3. Retry with exponential backoff — for retryable errors only
//   4. Usage tracking — fire-and-forget after each live completion
//   5. JSON validation — parse + return typed JSON when jsonMode=true
//
// Usage:
//   import { gateway } from "@oneatlas/ai";
//
//   const res = await gateway.complete({
//     tier: "fast",
//     messages: [{ role: "user", content: "Generate a CRM schema" }],
//     jsonMode: true,
//     cacheKey: "crm-schema-v1",
//   });
// =============================================================================

import type {
  AIProvider,
  AIProviderClient,
  CompletionRequest,
  CompletionResponse,
  GatewayConfig,
  JsonCompletionResponse,
  ModelTier,
  UsageRecord,
} from "./types";
import { AIGatewayError } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider }    from "./providers/openai";
import { GoogleProvider }    from "./providers/google";
import { DeepSeekProvider }  from "./providers/deepseek";
import { getCachedResponse, setCachedResponse } from "./cache/responseCache";
import { trackUsage } from "./usage";

// ── Default gateway config ────────────────────────────────────────────────────

const DEFAULT_CONFIG: GatewayConfig = {
  defaultProvider:        (process.env.AI_DEFAULT_PROVIDER as AIProvider) ?? "anthropic",
  fallbackProvider:       (process.env.AI_FALLBACK_PROVIDER as AIProvider) ?? "openai",
  cacheEnabled:           process.env.AI_CACHE_ENABLED !== "false",
  usageTrackingEnabled:   process.env.AI_USAGE_TRACKING !== "false",
  maxRetries:             2,
  retryBaseDelayMs:       500,
};

// ── Provider factory ──────────────────────────────────────────────────────────

function buildProvider(name: AIProvider): AIProviderClient {
  switch (name) {
    case "anthropic": return new AnthropicProvider();
    case "openai":    return new OpenAIProvider();
    case "google":    return new GoogleProvider();
    case "deepseek":  return new DeepSeekProvider();
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const isRetryable =
        err instanceof AIGatewayError ? err.retryable : false;

      if (!isRetryable || attempt === maxRetries) break;

      const delay = baseDelayMs * Math.pow(2, attempt); // exponential backoff
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

// ── Gateway class ─────────────────────────────────────────────────────────────

export class AIGateway {
  private readonly config: GatewayConfig;

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Main completion ─────────────────────────────────────────────────────────

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const tier: ModelTier = req.tier ?? "smart";

    // 1. Cache check
    if (this.config.cacheEnabled && req.cacheKey) {
      const cached = await getCachedResponse(req.cacheKey);
      if (cached) {
        return { ...cached, cached: true, latencyMs: 0 };
      }
    }

    // 2. Determine provider order
    const primary  = req.provider ?? this.config.defaultProvider;
    const fallback = this.config.fallbackProvider;
    const providers = fallback && fallback !== primary
      ? [primary, fallback]
      : [primary];

    let response: CompletionResponse | null = null;
    let lastError: unknown;

    for (const providerName of providers) {
      try {
        const client = buildProvider(providerName);

        response = await withRetry(
          () => client.complete(req),
          this.config.maxRetries,
          this.config.retryBaseDelayMs,
        );

        break; // success — stop trying providers
      } catch (err) {
        lastError = err;
        // try next provider
      }
    }

    if (!response) {
      throw new AIGatewayError(
        `All AI providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        primary,
        undefined,
        false,
      );
    }

    // 3. Cache the successful response
    if (this.config.cacheEnabled && req.cacheKey) {
      void setCachedResponse(req.cacheKey, response, req.cacheTtl ?? 3600);
    }

    // 4. Usage tracking (fire-and-forget)
    if (this.config.usageTrackingEnabled) {
      const usageRecord: UsageRecord = {
        provider:         response.provider,
        model:            response.model,
        promptTokens:     response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens:      response.usage.totalTokens,
        tier,
        cached:           false,
        latencyMs:        response.latencyMs,
        timestamp:        new Date().toISOString(),
      };
      void trackUsage(usageRecord);
    }

    return response;
  }

  // ── JSON completion — parse and return typed data ───────────────────────────

  async completeJson<T = unknown>(
    req: CompletionRequest,
  ): Promise<JsonCompletionResponse<T>> {
    const res = await this.complete({ ...req, jsonMode: true });

    let data: T;
    try {
      const clean = res.text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      data = JSON.parse(clean) as T;
    } catch {
      throw new AIGatewayError(
        `AI returned malformed JSON. Raw text: ${res.text.slice(0, 200)}`,
        res.provider,
        undefined,
        false,
      );
    }

    return { ...res, data };
  }

  // ── Convenience: text-only shorthand ───────────────────────────────────────

  async ask(
    prompt: string,
    options: Omit<CompletionRequest, "messages"> = {},
  ): Promise<string> {
    const res = await this.complete({
      ...options,
      messages: [{ role: "user", content: prompt }],
    });
    return res.text;
  }
}

// ── Singleton gateway (shared across the app) ─────────────────────────────────

export const gateway = new AIGateway();
