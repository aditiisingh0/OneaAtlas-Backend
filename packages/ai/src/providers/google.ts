// =============================================================================
// packages/ai/src/providers/google.ts
//
// Row 20 — AI Gateway: Google Gemini Provider
//
// Wraps the Google Generative Language API (generateContent).
// Uses the REST endpoint — no SDK dependency needed.
// =============================================================================

import type {
  AIProviderClient,
  CompletionRequest,
  CompletionResponse,
} from "../types";
import { AIGatewayError } from "../types";
import { getModelId } from "../models";

const GOOGLE_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

export class GoogleProvider implements AIProviderClient {
  readonly name = "google" as const;

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.GOOGLE_AI_API_KEY;
    if (!key) throw new Error("GOOGLE_AI_API_KEY is not configured");
    this.apiKey = key;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = getModelId("google", req.tier ?? "smart");
    const start = Date.now();

    // Build system instruction
    const systemContent =
      req.systemPrompt ??
      req.messages.find((m) => m.role === "system")?.content;

    const effectiveSystem = req.jsonMode
      ? `${systemContent ?? ""}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.`.trim()
      : systemContent;

    // Gemini uses "contents" with "parts"
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.maxTokens   ?? 4096,
        temperature:     req.temperature ?? 0.2,
        ...(req.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    if (effectiveSystem) {
      body.systemInstruction = {
        parts: [{ text: effectiveSystem }],
      };
    }

    const url = `${GOOGLE_API_BASE}/${model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new AIGatewayError(
        `Google AI API error ${res.status}: ${errText}`,
        "google",
        res.status,
        retryable,
      );
    }

    const data = await res.json();

    const text: string =
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const usage = data.usageMetadata ?? {};

    return {
      text,
      provider: "google",
      model,
      usage: {
        promptTokens:     usage.promptTokenCount     ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens:      usage.totalTokenCount      ?? 0,
      },
      cached:    false,
      latencyMs: Date.now() - start,
    };
  }
}
