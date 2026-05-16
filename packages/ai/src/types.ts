// =============================================================================
// packages/ai/src/types.ts
//
// Row 20 — AI Gateway: Core Types
//
// All shared types for the AI abstraction layer.
// Providers are swappable behind these interfaces.
// =============================================================================

// ── Provider identifiers ──────────────────────────────────────────────────────

export type AIProvider = "anthropic" | "openai" | "google" | "deepseek";

// ── Tier determines which model to pick ──────────────────────────────────────

export type ModelTier =
  | "fast"   // cheap, low-latency — CRUD, boilerplate, UI gen
  | "smart"; // high-quality reasoning — complex generation

// ── Message format (normalized, OpenAI-compatible) ───────────────────────────

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ── Completion request ────────────────────────────────────────────────────────

export interface CompletionRequest {
  messages: AIMessage[];
  systemPrompt?: string;
  /**
   * Which tier to use. Gateway picks the right model per provider.
   * Default: "smart"
   */
  tier?: ModelTier;
  /**
   * Override the provider. If omitted the gateway picks the default.
   */
  provider?: AIProvider;
  /**
   * Max output tokens. Default: 4096.
   */
  maxTokens?: number;
  /**
   * 0–1 temperature. Default: 0.2 for generation tasks.
   */
  temperature?: number;
  /**
   * If true, force JSON output (adds system instruction + validates).
   */
  jsonMode?: boolean;
  /**
   * Optional cache key. If provided, response is cached in Redis.
   * Use a deterministic string (e.g. hash of prompt).
   */
  cacheKey?: string;
  /**
   * Cache TTL in seconds. Default: 3600 (1 hr).
   */
  cacheTtl?: number;
}

// ── Completion response ───────────────────────────────────────────────────────

export interface CompletionResponse {
  text: string;
  provider: AIProvider;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** True if the response was served from cache */
  cached: boolean;
  /** Wall-clock latency in ms (0 if cached) */
  latencyMs: number;
}

// ── Structured JSON completion ────────────────────────────────────────────────

export interface JsonCompletionResponse<T = unknown> extends CompletionResponse {
  data: T;
}

// ── Token usage tracking ─────────────────────────────────────────────────────

export interface UsageRecord {
  provider: AIProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tier: ModelTier;
  cached: boolean;
  latencyMs: number;
  timestamp: string;
  /** Optional org/project for per-tenant tracking */
  orgId?: string;
  projectId?: string;
}

// ── Gateway config ────────────────────────────────────────────────────────────

export interface GatewayConfig {
  /** Primary provider to try first */
  defaultProvider: AIProvider;
  /** Fallback provider if primary fails */
  fallbackProvider?: AIProvider;
  /** Enable Redis response caching */
  cacheEnabled: boolean;
  /** Log all completions for cost tracking */
  usageTrackingEnabled: boolean;
  /** Max retry attempts per provider */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelayMs: number;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface AIProviderClient {
  readonly name: AIProvider;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class AIGatewayError extends Error {
  constructor(
    message: string,
    public readonly provider: AIProvider,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "AIGatewayError";
  }
}
