#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
temp_dir="$(mktemp -d)"
fava_port="${FAVAI_TOOL_E2E_PORT:-5512}"
stub_port="${FAVAI_TOOL_E2E_STUB_PORT:-8892}"
browser_session="favai-tool-result-bubble-$$"
fava_pid=""
stub_pid=""

cleanup() {
  status=$?
  agent-browser --session "$browser_session" close >/dev/null 2>&1 || true
  if [[ -n "$fava_pid" ]]; then kill "$fava_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$stub_pid" ]]; then kill "$stub_pid" >/dev/null 2>&1 || true; fi
  if [[ $status -ne 0 ]]; then
    tail -50 "$temp_dir/fava.log" 2>/dev/null || true
    tail -50 "$temp_dir/stub.log" 2>/dev/null || true
  fi
  rm -rf "$temp_dir"
  exit "$status"
}
trap cleanup EXIT

cp "$repo_dir/e2e/fixtures/pure-image.beancount" "$temp_dir/ledger.beancount"
sed -i.bak \
  -e "s/127.0.0.1:8891/127.0.0.1:$stub_port/" \
  -e "s/'vision': True/'vision': False/" \
  "$temp_dir/ledger.beancount"

uv run python "$repo_dir/e2e/openai_stub.py" --port "$stub_port" \
  >"$temp_dir/stub.log" 2>&1 &
stub_pid=$!
uv run fava "$temp_dir/ledger.beancount" -p "$fava_port" \
  >"$temp_dir/fava.log" 2>&1 &
fava_pid=$!

base_url="http://127.0.0.1:$fava_port/favai-e2e/extension/FavaAI/"
agent-browser --session "$browser_session" open "$base_url"
agent-browser --session "$browser_session" wait --text "FavAI"
agent-browser --session "$browser_session" wait \
  'textarea[aria-label="Write your prompt here"]'
agent-browser --session "$browser_session" fill \
  'textarea[aria-label="Write your prompt here"]' \
  "E2E_TOOL_RESULT_BUBBLE 请调用 today 工具"
agent-browser --session "$browser_session" find role button click --name "Send message"
agent-browser --session "$browser_session" wait --text "最终输出。"

agent-browser --session "$browser_session" eval --stdin <<'JS'
(() => {
  const bubbles = document.querySelectorAll(".favai-root .favai-bubble");
  const assistantBubbles = document.querySelectorAll(
    ".favai-root .favai-bubble.favai-bubble-start",
  );
  if (bubbles.length !== 2) {
    throw new Error(`expected 2 chat bubbles, found ${bubbles.length}`);
  }
  if (assistantBubbles.length !== 1) {
    throw new Error(
      `expected 1 assistant bubble, found ${assistantBubbles.length}`,
    );
  }
  const assistantBubble = assistantBubbles.item(0);
  const content = assistantBubble.textContent ?? "";
  if (!content.includes("today") || !content.includes("返回结果")) {
    throw new Error("tool result was not merged into the tool-call collapse block");
  }
  const expectedOrder = [
    "思考过程",
    "today",
    "思考过程",
    "中间输出。",
    "today",
    "思考过程",
    "最终输出。",
  ];
  let previousIndex = -1;
  for (const expected of expectedOrder) {
    const index = content.indexOf(expected, previousIndex + 1);
    if (index <= previousIndex) {
      throw new Error(
        `content is out of order at: ${expected}; actual: ${JSON.stringify(content)}`,
      );
    }
    previousIndex = index;
  }
  return true;
})()
JS

echo "tool-result bubble E2E passed"
