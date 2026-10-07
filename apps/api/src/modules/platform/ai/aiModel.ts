// The model behind AI assist (phase 7). One structured-output request per
// draft: the system prompt and the draft shape come from
// packages/shared/src/aiAssist.ts, the answer is parsed against the zod
// schemas below and then checked again by the shared converters.
//
// Configuration (API server environment):
//   ANTHROPIC_API_KEY      required; without it AI assist reports "not configured"
//   VHYXVOID_AI_MODEL      optional model id, default claude-opus-5-5
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import type { MockDraft, TestsDraft } from "@vhyxvoid/shared";

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

const mockDraftSchema = z.object({
  summary: z.string(),
  endpoints: z.array(
    z.object({
      name: z.string(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"]),
      path: z.string(),
      responses: z.array(
        z.object({
          name: z.string(),
          status: z.number().int(),
          contentType: z.string(),
          body: z.string(),
          templating: z.boolean(),
          isDefault: z.boolean(),
          when: z.array(
            z.object({
              source: z.enum(["query", "header", "param", "cookie", "body", "method", "path"]),
              key: z.string(),
              op: z.enum(["equals", "not_equals", "contains", "exists", "not_exists", "regex"]),
              value: z.string(),
            }),
          ),
        }),
      ),
    }),
  ),
});

const testsDraftSchema = z.object({
  name: z.string(),
  summary: z.string(),
  baseUrl: z.string(),
  variables: z.array(z.object({ key: z.string(), value: z.string() })),
  requests: z.array(
    z.object({
      name: z.string(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
      url: z.string(),
      headers: z.array(z.object({ key: z.string(), value: z.string() })),
      jsonBody: z.string(),
      checks: z.array(
        z.object({
          source: z.enum(["status", "header", "json", "body", "time", "size"]),
          path: z.string(),
          op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "exists", "notExists", "matches", "type", "schema"]),
          value: z.string(),
        }),
      ),
      captures: z.array(z.object({ variable: z.string(), source: z.enum(["json", "header", "status", "body"]), path: z.string() })),
    }),
  ),
});

export type DraftResult<T> = { draft: T; model: string; inputTokens: number; outputTokens: number };

/** What the routes need from a model; tests pass a fake. */
export interface AiModel {
  readonly model: string;
  mock(system: string, prompt: string): Promise<DraftResult<MockDraft>>;
  tests(system: string, prompt: string): Promise<DraftResult<TestsDraft>>;
}

/** A failure to show the user as is (refusal, cut-off answer, provider down). */
export class AiDraftError extends Error {
  constructor(
    message: string,
    readonly code: "refused" | "too_long" | "unparsed" | "unavailable" | "rate_limited",
  ) {
    super(message);
  }
}

export function anthropicModel(env: NodeJS.ProcessEnv = process.env): AiModel | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}), timeout: 240_000, maxRetries: 1 });
  const model = env.VHYXVOID_AI_MODEL?.trim() || DEFAULT_AI_MODEL;

  async function run<S extends z.ZodType>(schema: S, system: string, prompt: string): Promise<DraftResult<z.infer<S>>> {
    let res;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: 16_000,
        // On a policy decline the API retries on a fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AiDraftError("AI assist is busy right now; try again in a minute", "rate_limited");
      if (err instanceof Anthropic.APIError) throw new AiDraftError(`AI assist is unavailable right now (${err.status ?? "network"})`, "unavailable");
      throw err;
    }
    if (res.stop_reason === "refusal") throw new AiDraftError("The model declined this request; rephrase the description", "refused");
    if (res.stop_reason === "max_tokens") throw new AiDraftError("The draft got too long; describe fewer endpoints or requests at a time", "too_long");
    // Parsed here rather than by messages.parse, so a refusal or a cut-off
    // answer is reported as such instead of as a parse error.
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed: z.ZodSafeParseResult<z.infer<S>>;
    try {
      parsed = schema.safeParse(JSON.parse(text));
    } catch {
      throw new AiDraftError("The model's answer could not be read; try again", "unparsed");
    }
    if (!parsed.success) throw new AiDraftError("The model's answer did not have the expected shape; try again", "unparsed");
    return { draft: parsed.data, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }

  return {
    model,
    mock: (system, prompt) => run(mockDraftSchema, system, prompt) as Promise<DraftResult<MockDraft>>,
    tests: (system, prompt) => run(testsDraftSchema, system, prompt) as Promise<DraftResult<TestsDraft>>,
  };
}
