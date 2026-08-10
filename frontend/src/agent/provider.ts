/**
 * Build pi-ai ``Models`` and ``Model`` from the user's favai config.
 */

import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import type { Model } from "@earendil-works/pi-ai";
import type { Config } from "@/api";
import { SENTINEL } from "./fetchShim";

export interface BuiltModels {
  models: ReturnType<typeof createModels>;
  model: Model<
    "openai-completions" | "openai-responses" | "anthropic-messages"
  >;
}

export function buildModels(config: Config): BuiltModels {
  // Keep provider and model identities independent: the provider selects the
  // stored configuration, while the model id is forwarded upstream unchanged.
  const providerId = config.provider;
  const input: ("text" | "image")[] = config.vision
    ? ["text", "image"]
    : ["text"];

  const model: Model<
    "openai-completions" | "openai-responses" | "anthropic-messages"
  > = {
    id: config.model,
    name: config.model,
    api: config.api,
    provider: providerId,
    // The sentinel domain has no path — the SDK appends its own suffix
    // (OpenAI Responses → /responses, Chat Completions → /chat/completions,
    // Anthropic → /v1/messages).
    // The backend proxy prepends config.base_url to the captured path.
    baseUrl: SENTINEL,
    // Responses providers can return reasoning summaries. Mark the model as
    // reasoning-capable so the agent's thinking level is forwarded to pi-ai.
    reasoning: config.api === "openai-responses",
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.context_window,
    maxTokens: config.max_tokens,
    // pi-ai's API implementations read model.headers, not provider.headers.
    // The backend uses this header to load the matching provider config.
    headers: { "X-Favai-Provider": config.provider },
  };

  const models = createModels();
  const apiImpl = config.api === "anthropic-messages"
    ? anthropicMessagesApi()
    : config.api === "openai-responses"
      ? openAIResponsesApi()
      : openAICompletionsApi();
  models.setProvider(
    createProvider({
      id: providerId,
      headers: { "X-Favai-Provider": config.provider },
      auth: {
        apiKey: {
          name: "favai proxy key",
          resolve: async () => ({ auth: { authType: "apiKey" as const, apiKey: "favai-proxy" } }),
        },
      },
      models: [model as never],
      api: apiImpl,
    }),
  );

  return { models, model };
}
