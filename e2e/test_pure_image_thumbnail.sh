#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
temp_dir="$(mktemp -d)"
fava_port="${FAVAI_E2E_PORT:-5511}"
stub_port="${FAVAI_E2E_STUB_PORT:-8891}"
browser_session="favai-pure-image-thumbnail-$$"
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
if [[ "$stub_port" != "8891" ]]; then
  sed -i.bak "s/127.0.0.1:8891/127.0.0.1:$stub_port/" "$temp_dir/ledger.beancount"
fi

uv run python "$repo_dir/e2e/openai_stub.py" --port "$stub_port" \
  >"$temp_dir/stub.log" 2>&1 &
stub_pid=$!
uv run fava "$temp_dir/ledger.beancount" -p "$fava_port" \
  >"$temp_dir/fava.log" 2>&1 &
fava_pid=$!

base_url="http://127.0.0.1:$fava_port/favai-e2e/extension/FavaAI/"
agent-browser --session "$browser_session" open "$base_url"
agent-browser --session "$browser_session" wait --text "FavAI"

# Drop a valid 1x1 PNG without accompanying text. This exercises the exact
# vision-only branch where no OCR content block exists.
agent-browser --session "$browser_session" eval --stdin <<'JS'
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const file = new File([bytes], "thumbnail.png", { type: "image/png" });
const transfer = new DataTransfer();
transfer.items.add(file);
const textarea = document.querySelector('textarea[aria-label="Write your prompt here"]');
if (!textarea) throw new Error("message textarea not found");
textarea.dispatchEvent(new DragEvent("drop", {
  bubbles: true,
  cancelable: true,
  dataTransfer: transfer,
}));
JS

agent-browser --session "$browser_session" wait 'img[alt="thumbnail.png"]'
agent-browser --session "$browser_session" find role button click --name "Send message"
agent-browser --session "$browser_session" wait --text "图片已处理。"
agent-browser --session "$browser_session" wait 'img[alt="image-1"]'

# Assert both the visible thumbnail and the persisted pi-ai image shape.
agent-browser --session "$browser_session" eval --stdin <<'JS'
(async () => {
const thumbnail = document.querySelector('img[alt="image-1"]');
if (!thumbnail || thumbnail.clientWidth === 0 || thumbnail.clientHeight === 0) {
  throw new Error("submitted image thumbnail is not visible");
}
const base = window.location.pathname.endsWith("/")
  ? window.location.pathname
  : `${window.location.pathname}/`;
const listBody = await fetch(`${base}sessions?limit=1`).then(response => response.json());
const sessionId = listBody.data.sessions[0]?.id;
const sessionBody = await fetch(`${base}session?session_id=${encodeURIComponent(sessionId)}`)
  .then(response => response.json());
const userMessage = sessionBody.data.messages.find(message => message.role === "user");
const image = Array.isArray(userMessage?.content)
  ? userMessage.content.find(block => block.type === "image")
  : undefined;
if (!image?.data || image.mimeType !== "image/png") {
  throw new Error("persisted user message is missing a typed PNG image block");
}
return true;
})()
JS

echo "pure-image thumbnail E2E passed"
