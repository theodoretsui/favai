#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
temp_dir="$(mktemp -d)"
fava_port="${FAVAI_APPROVAL_E2E_PORT:-5514}"
stub_port="${FAVAI_APPROVAL_E2E_STUB_PORT:-8894}"
browser_session="favai-approval-inline-$$"
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
  "E2E_APPROVAL_INLINE 创建账本文件"
agent-browser --session "$browser_session" find role button click --name "Send message"

# The gated write tool must surface an inline approval bar inside the composer.
agent-browser --session "$browser_session" wait \
  '.favai-approval-inline'

agent-browser --session "$browser_session" eval --stdin <<'JS'
(() => {
  const bar = document.querySelector(".favai-approval-inline");
  if (!(bar instanceof HTMLElement)) {
    throw new Error("approval bar not found");
  }
  if (!bar.textContent?.includes("create_ledger_file")) {
    throw new Error("approval bar does not name the tool");
  }

  // The bar must live inside the Sender (embedded in the composer),
  // not as a standalone card above the chat.
  const sender = bar.closest(".favai-sender");
  if (!(sender instanceof HTMLElement)) {
    throw new Error("approval bar is not embedded inside the sender");
  }

  // Approve/deny buttons must be present (antd inserts spacing between
  // two-CJK-character button labels, e.g. "拒 绝").
  const buttons = Array.from(bar.querySelectorAll("button")).map((b) => b.textContent);
  if (!buttons.some((text) => /批\s*准|Approve/i.test(text ?? ""))) {
    throw new Error(`approve button missing: ${JSON.stringify(buttons)}`);
  }
  if (!buttons.some((text) => /拒\s*绝|Deny/i.test(text ?? ""))) {
    throw new Error(`deny button missing: ${JSON.stringify(buttons)}`);
  }

  const barRect = bar.getBoundingClientRect();
  const senderRect = sender.getBoundingClientRect();
  return {
    senderContainsBar:
      barRect.top >= senderRect.top &&
      barRect.bottom <= senderRect.bottom &&
      barRect.left >= senderRect.left &&
      barRect.right <= senderRect.right,
    buttons,
  };
})()
JS

agent-browser --session "$browser_session" screenshot \
  "${FAVAI_APPROVAL_SCREENSHOT:-$temp_dir/approval-inline.png}"

# Approve and confirm the write completes.
agent-browser --session "$browser_session" eval --stdin <<'JS'
(() => {
  const approve = Array.from(
    document.querySelectorAll(".favai-approval-inline button"),
  ).find((b) => /批\s*准/.test(b.textContent ?? ""));
  if (!(approve instanceof HTMLElement)) {
    throw new Error("approve button not found");
  }
  approve.click();
})()
JS
agent-browser --session "$browser_session" wait --text "文件已创建。"

# The generated file must exist in the ledger directory.
if [[ ! -f "$temp_dir/sub_test.beancount" ]]; then
  echo "created file missing: $temp_dir/sub_test.beancount" >&2
  exit 1
fi
if ! grep -q 'include "sub_test.beancount"' "$temp_dir/ledger.beancount"; then
  echo "include statement missing from ledger" >&2
  exit 1
fi

echo "approval inline E2E passed (screenshot: $temp_dir/approval-inline.png)"
