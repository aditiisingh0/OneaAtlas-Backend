// =============================================================================
// packages/ai/src/providers/anthropic.ts
//
// Row 20 — AI Gateway: Anthropic Provider
//
// Wraps the Anthropic Messages API.
// Normalizes the response into CompletionResponse so the gateway is provider-agnostic.
// =============================================================================

import type {
  AIProviderClient,
  CompletionRequest,
  CompletionResponse,
} from "../types";
import { AIGatewayError } from "../types";
import { getModelId } from "../models";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider implements AIProviderClient {
  readonly name = "anthropic" as const;

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
    this.apiKey = key;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = getModelId("anthropic", req.tier ?? "smart");
    const start = Date.now();

    // Anthropic separates system prompt from messages
    const userMessages = req.messages.filter((m) => m.role !== "system");
    const systemContent =
      req.systemPrompt ??
      req.messages.find((m) => m.role === "system")?.content;

    // JSON mode: inject instruction into system prompt
    const effectiveSystem = req.jsonMode
      ? `${systemContent ?? ""}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.`.trim()
      : systemContent;

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (effectiveSystem) body.system = effectiveSystem;

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new AIGatewayError(
        `Anthropic API error ${res.status}: ${errText}`,
        "anthropic",
        res.status,
        retryable,
      );
    }

    const data = await res.json();

    const text: string = data.content?.[0]?.text ?? "";
    const usage = data.usage ?? {};

    return {
      text,
      provider: "anthropic",
      model,
      usage: {
        promptTokens:     usage.input_tokens      ?? 0,
        completionTokens: usage.output_tokens     ?? 0,
        totalTokens:      (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      },
      cached:    false,
      latencyMs: Date.now() - start,
    };
  }
}
