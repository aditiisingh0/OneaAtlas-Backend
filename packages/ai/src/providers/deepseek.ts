// =============================================================================
// packages/ai/src/providers/deepseek.ts
//
// Row 20 — AI Gateway: DeepSeek Provider
//
// DeepSeek exposes an OpenAI-compatible API, so this is a thin wrapper
// around the OpenAI provider with a different base URL + API key.
// =============================================================================

import type {
  AIProviderClient,
  CompletionRequest,
  CompletionResponse,
} from "../types";
import { AIGatewayError } from "../types";
import { getModelId } from "../models";

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

export class DeepSeekProvider implements AIProviderClient {
  readonly name = "deepseek" as const;

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY is not configured");
    this.apiKey = key;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = getModelId("deepseek", req.tier ?? "smart");
    const start = Date.now();

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

    // DeepSeek supports response_format for JSON mode
    if (req.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000), // DeepSeek reasoner can be slow
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new AIGatewayError(
        `DeepSeek API error ${res.status}: ${errText}`,
        "deepseek",
        res.status,
        retryable,
      );
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? {};

    return {
      text,
      provider: "deepseek",
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
