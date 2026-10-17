import { UserError } from "../core/errors.js";

/**
 * Model access for `localship translate`. Two wire protocols cover nearly every provider:
 * Anthropic's Messages API and the OpenAI-compatible chat completions API (OpenAI, Gemini,
 * OpenRouter, Ollama, LM Studio, vLLM…). Plain `fetch`, no SDKs.
 */
export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type Complete = (req: CompletionRequest) => Promise<string>;

export interface ProviderConfig {
  baseUrl: string;
  /** Environment variable holding the API key; none for local servers. */
  apiKeyEnv?: string;
}

interface BuiltIn extends ProviderConfig {
  protocol: "anthropic" | "openai";
  /** Other variables that may hold the key. */
  altKeyEnv?: string[];
}

const BUILT_IN: Record<string, BuiltIn> = {
  anthropic: {
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  openai: { protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  gemini: {
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    altKeyEnv: ["GOOGLE_API_KEY"],
  },
  openrouter: {
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  ollama: { protocol: "openai", baseUrl: "http://localhost:11434/v1" },
  lmstudio: { protocol: "openai", baseUrl: "http://localhost:1234/v1" },
};

export const PROVIDER_NAMES = Object.keys(BUILT_IN);

/** Splits `provider:model`. The model part may itself contain colons (`ollama:qwen3:8b`). */
export function parseModel(spec: string): { provider: string; model: string } {
  const i = spec.indexOf(":");
  if (i <= 0 || i === spec.length - 1) {
    throw new UserError(
      `Model "${spec}" should be provider:model, e.g. anthropic:claude-sonnet-5-5 (providers: ${PROVIDER_NAMES.join(", ")}, or one under \`providers:\` in the config)`,
    );
  }
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) };
}

export interface ProviderOptions {
  /** Providers from the config, added to or overriding the built-in ones. */
  custom?: Record<string, ProviderConfig>;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Deadline for headers and response body; default two minutes. */
  timeoutMs?: number;
}

export function createCompletion(spec: string, opts: ProviderOptions = {}): Complete {
  const { provider, model } = parseModel(spec);
  const env = opts.env ?? process.env;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new UserError("timeoutMs must be a positive integer no greater than 2147483647");
  }
  const custom = opts.custom?.[provider];
  const builtIn = BUILT_IN[provider];
  if (!custom && !builtIn) {
    throw new UserError(
      `Unknown provider "${provider}". Use one of ${PROVIDER_NAMES.join(", ")}, or add it under \`providers:\` in the config with its baseUrl.`,
    );
  }
  const protocol = custom ? "openai" : (builtIn as BuiltIn).protocol;
  const baseUrl = (custom?.baseUrl ?? (builtIn as BuiltIn).baseUrl).replace(/\/+$/, "");
  const keyNames = custom
    ? custom.apiKeyEnv
      ? [custom.apiKeyEnv]
      : []
    : [builtIn?.apiKeyEnv, ...(builtIn?.altKeyEnv ?? [])].filter((k): k is string => !!k);
  const apiKey = keyNames.map((k) => env[k]).find(Boolean);
  if (keyNames.length > 0 && !apiKey) {
    throw new UserError(`Set ${keyNames[0]} to use ${provider} models.`);
  }

  const post = async (
    url: string,
    headers: Record<string, string>,
    body: unknown,
    external?: AbortSignal,
  ) => {
    const deadline = new AbortController();
    const signal = external ? AbortSignal.any([external, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    try {
      signal.throwIfAborted();
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
      const text = await res.text();
      signal.throwIfAborted();
      if (!res.ok) {
        throw new ProviderError(
          `${provider} returned ${res.status}: ${text.slice(0, 500)}`,
          res.status === 429 || res.status >= 500,
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderError(
          `${provider} returned something that isn't JSON: ${text.slice(0, 200)}`,
        );
      }
    } catch (e) {
      if (external?.aborted) throw new UserError("Translation cancelled");
      if (deadline.signal.aborted) {
        throw new ProviderError(
          `${provider}: request timed out after ${timeoutMs} ms; retry or increase --timeout-ms`,
        );
      }
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`${provider}: could not reach ${baseUrl} (${(e as Error).message})`);
    } finally {
      clearTimeout(timer);
    }
  };

  if (protocol === "anthropic") {
    return async (req) => {
      const data = (await post(
        `${baseUrl}/messages`,
        { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: req.maxTokens ?? 16_000,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
        },
        req.signal,
      )) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
      if (data.stop_reason === "max_tokens") {
        throw new ProviderError(`${provider}: the response was cut off; use a smaller batch`);
      }
      return (data.content ?? []).map((c) => c.text ?? "").join("");
    };
  }
  return async (req) => {
    const data = (await post(
      `${baseUrl}/chat/completions`,
      apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      {
        model,
        max_tokens: req.maxTokens ?? 16_000,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      },
      req.signal,
    )) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new ProviderError(`${provider}: the response was cut off; use a smaller batch`);
    }
    return choice?.message?.content ?? "";
  };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** Worth retrying later: rate limits and server errors. */
    readonly transient = false,
  ) {
    super(message);
  }
}
