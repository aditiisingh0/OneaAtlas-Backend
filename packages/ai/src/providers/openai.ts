// =============================================================================
// packages/ai/src/providers/openai.ts
//
// Row 20 — AI Gateway: OpenAI Provider
//
// Wraps the OpenAI Chat Completions API (v1).
// Compatible with any OpenAI-spec endpoint (OpenAI, Azure, local models).
// =============================================================================

import type {
  AIProviderClient,
  CompletionRequest,
  CompletionResponse,
} from "../types";
import { AIGatewayError } from "../types";
import { getModelId } from "../models";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIProvider implements AIProviderClient {
  readonly name = "openai" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not configured");
    this.apiKey  = key;
    this.baseUrl = baseUrl ?? OPENAI_API_URL;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = getModelId("openai", req.tier ?? "smart");
    const start = Date.now();

    // Build messages — inject system prompt if provided
    const messages: { role: string; content: string }[] = [];

    const systemContent =
      req.systemPrompt ??
      req.messages.find((m) => m.role === "system")?.content;

    const effectiveSystem = req.jsonMode
      ? `${systemContent ?? ""}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.`.trim()
      : systemContent;

    if (effectiveSystem) {
      messages.push({ role: "system", content: effectiveSystem });
    }

    for (const m of req.messages.filter((m) => m.role !== "system")) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens:  req.maxTokens   ?? 4096,
      temperature: req.temperature ?? 0.2,
      messages,
    };

    // OpenAI native JSON mode (only supported on select models)
    if (req.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new AIGatewayError(
        `OpenAI API error ${res.status}: ${errText}`,
        "openai",
        res.status,
        retryable,
      );
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? {};

    return {
      text,
      provider: "openai",
      model,
      usage: {
        promptTokens:     usage.prompt_tokens     ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens:      usage.total_tokens      ?? 0,
      },
      cached:    false,
      latencyMs: Date.now() - start,
    };
  }
}
