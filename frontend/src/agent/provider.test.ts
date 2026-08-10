import { describe, expect, it, vi } from "vitest";

import type { ApiKind, Config } from "@/api";

vi.mock("./fetchShim", () => ({
  SENTINEL: "https://favai-proxy.invalid",
}));

import { createChatAgent } from "./factory";
import { buildModels } from "./provider";

function config(api: ApiKind): Config {
  return {
    provider: "test-provider",
    api,
    base_url: "https://example.test/v1",
    model: "test-model",
    models: ["test-model"],
    api_key: "",
    api_key_stored: false,
    vision: false,
    context_window: 128_000,
    max_tokens: 16_384,
  };
}

describe("Responses provider reasoning", () => {
  it("marks Responses models as reasoning-capable", () => {
    expect(buildModels(config("openai-responses")).model.reasoning).toBe(true);
    expect(buildModels(config("openai-completions")).model.reasoning).toBe(false);
  });

  it("enables a default thinking level for Responses agents", () => {
    expect(createChatAgent(config("openai-responses")).state.thinkingLevel).toBe(
      "medium",
    );
    expect(createChatAgent(config("openai-completions")).state.thinkingLevel).toBe(
      "off",
    );
  });
});
