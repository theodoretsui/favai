/**
 * Build pi-ai ``Models`` and ``Model`` from the user's favai config.
 */

import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import type { Model } from "@earendil-works/pi-ai";
import type { Config } from "@/api";
import { SENTINEL } from "./fetchShim";

export interface BuiltModels {
  models: ReturnType<typeof createModels>;
  model: Model<"openai-completions" | "anthropic-messages">;
}

export function buildModels(config: Config): BuiltModels {
  const input: ("text" | "image")[] = config.vision
    ? ["text", "image"]
    : ["text"];

  const model: Model<"openai-completions" | "anthropic-messages"> = {
    id: config.model,
    name: config.model,
    api: config.api,
    provider: "favai",
    // The sentinel domain has no path — the SDK appends its own suffix
    // (openai → /chat/completions, anthropic → /v1/messages).
    // The backend proxy prepends config.base_url to the captured path.
    baseUrl: SENTINEL,
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.context_window,
    maxTokens: config.max_tokens,
  };

  const models = createModels();
  const apiImpl = config.api === "anthropic-messages"
    ? anthropicMessagesApi()
    : openAICompletionsApi();
  models.setProvider(
    createProvider({
      id: "favai",
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
