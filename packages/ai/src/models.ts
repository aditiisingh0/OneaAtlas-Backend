// =============================================================================
// packages/ai/src/models.ts
//
// Row 20 — AI Gateway: Model Registry
//
// Single source of truth for which model string to use per provider + tier.
// Update here when providers release new models — no other file needs changing.
// =============================================================================

import type { AIProvider, ModelTier } from "./types";

// ── Model registry ────────────────────────────────────────────────────────────

const MODEL_REGISTRY: Record<AIProvider, Record<ModelTier, string>> = {
  anthropic: {
    fast:  "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-20250514",
  },
  openai: {
    fast:  "gpt-4o-mini",
    smart: "gpt-4o",
  },
  google: {
    fast:  "gemini-1.5-flash",
    smart: "gemini-1.5-pro",
  },
  deepseek: {
    fast:  "deepseek-chat",
    smart: "deepseek-reasoner",
  },
};

// ── Cost table (USD per 1M tokens) ───────────────────────────────────────────
// Used for usage logging / cost estimation. Update as pricing changes.

export interface ModelCost {
  inputPer1M: number;   // USD
  outputPer1M: number;  // USD
}

const COST_TABLE: Record<string, ModelCost> = {
  // Anthropic
  "claude-haiku-4-5-20251001":   { inputPer1M: 0.80,   outputPer1M: 4.00  },
  "claude-sonnet-4-20250514":    { inputPer1M: 3.00,   outputPer1M: 15.00 },
  // OpenAI
  "gpt-4o-mini":                 { inputPer1M: 0.15,   outputPer1M: 0.60  },
  "gpt-4o":                      { inputPer1M: 5.00,   outputPer1M: 15.00 },
  // Google
  "gemini-1.5-flash":            { inputPer1M: 0.075,  outputPer1M: 0.30  },
  "gemini-1.5-pro":              { inputPer1M: 3.50,   outputPer1M: 10.50 },
  // DeepSeek
  "deepseek-chat":               { inputPer1M: 0.14,   outputPer1M: 0.28  },
  "deepseek-reasoner":           { inputPer1M: 0.55,   outputPer1M: 2.19  },
};

// ── Public helpers ────────────────────────────────────────────────────────────

export function getModelId(provider: AIProvider, tier: ModelTier): string {
  return MODEL_REGISTRY[provider][tier];
}

export function getModelCost(model: string): ModelCost {
  return COST_TABLE[model] ?? { inputPer1M: 0, outputPer1M: 0 };
}

/**
 * Estimate cost in USD cents for a completion.
 * Returns 0 if model is unknown (safe default).
 */
export function estimateCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const cost = getModelCost(model);
  const inputCost  = (promptTokens     / 1_000_000) * cost.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * cost.outputPer1M;
  return Math.round((inputCost + outputCost) * 100);
}

export { MODEL_REGISTRY };
