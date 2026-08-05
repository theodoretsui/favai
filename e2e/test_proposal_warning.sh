#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
temp_dir="$(mktemp -d)"
fava_port="${FAVAI_PROPOSAL_E2E_PORT:-5513}"
stub_port="${FAVAI_PROPOSAL_E2E_STUB_PORT:-8893}"
browser_session="favai-proposal-warning-$$"
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
  "E2E_PROPOSAL_WARNING 提交一条待确认交易"
agent-browser --session "$browser_session" find role button click --name "Send message"
agent-browser --session "$browser_session" wait --text "待确认提案已提交。"
agent-browser --session "$browser_session" wait --text "待确认"

agent-browser --session "$browser_session" eval --stdin <<'JS'
(() => {
  const card = document.querySelector(".favai-proposal-incomplete");
  if (!(card instanceof HTMLElement)) {
    throw new Error("incomplete proposal warning card not found");
  }
  if (!card.textContent?.includes("待确认")) {
    throw new Error("incomplete proposal warning label not found");
  }

  const style = getComputedStyle(card);
  if (style.boxShadow === "none" || style.borderColor !== "rgb(250, 173, 20)") {
    throw new Error("incomplete proposal warning styles were not applied");
  }

  const formItems = card.querySelectorAll(".favai-form-item");
  if (formItems.length < 4) {
    throw new Error(`expected four transaction fields, found ${formItems.length}`);
  }
  const widths = Array.from(formItems)
    .slice(0, 4)
    .map((item) => item.getBoundingClientRect().width);
  const [dateFieldWidth, payeeFieldWidth, narrationFieldWidth] = widths;
  const dateInput = formItems.item(0).querySelector('input[type="date"]');
  const dateInputWidth = dateInput?.getBoundingClientRect().width ?? 0;
  if (dateInputWidth < 145 || dateFieldWidth < payeeFieldWidth * 0.95) {
    throw new Error(
      `date field is still too narrow: ${JSON.stringify({ widths, dateInputWidth })}`,
    );
  }
  if (Math.abs(payeeFieldWidth - narrationFieldWidth) > 2) {
    throw new Error(`payee and narration widths differ: ${JSON.stringify(widths)}`);
  }
  return {
    widths,
    dateInputWidth,
    borderColor: style.borderColor,
    boxShadow: style.boxShadow,
  };
})()
JS

echo "proposal warning E2E passed"
