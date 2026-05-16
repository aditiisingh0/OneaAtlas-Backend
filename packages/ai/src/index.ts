// =============================================================================
// packages/ai/src/index.ts
//
// Row 20 — AI Gateway: Public API
//
// Import from "@oneatlas/ai" everywhere.
// =============================================================================

// Gateway
export { AIGateway, gateway } from "./gateway";

// Types
export type {
  AIProvider,
  AIProviderClient,
  CompletionRequest,
  CompletionResponse,
  JsonCompletionResponse,
  GatewayConfig,
  ModelTier,
  UsageRecord,
} from "./types";
export { AIGatewayError } from "./types";

// Model registry helpers
export { getModelId, getModelCost, estimateCostCents } from "./models";

// Usage tracking
export { trackUsage, getOrgUsage, getOrgUsageSummary } from "./usage";

// Cache (for manual cache invalidation)
export { getCachedResponse, setCachedResponse, invalidateCachedResponse } from "./cache/responseCache";

// Providers (exported so callers can instantiate directly if needed)
export { AnthropicProvider } from "./providers/anthropic";
export { OpenAIProvider }    from "./providers/openai";
export { GoogleProvider }    from "./providers/google";
export { DeepSeekProvider }  from "./providers/deepseek";
