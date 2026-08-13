# favai

**AI Agent Extension for [Fava](https://github.com/beancount/fava).** favai lets you interact with your [Beancount](https://beancount.github.io/) ledger through natural language — import transactions, analyze income and expenses, and explore more agent-driven workflows.

## Features

- **Import bills** — paste bank statement text, upload screenshots, PDFs, or office documents (Word, Excel, PowerPoint, RTF, EPUB), and let an LLM agent extract transactions and map them to your ledger accounts
- **Chat with your ledger** — ask questions in natural language using BQL queries ("What was my food spend this month?")
- **Multi-turn editing** — give feedback to refine the proposed transactions before writing
- **Any LLM provider** — OpenAI-compatible or Anthropic-compatible APIs (supports custom endpoints and `$ENV_VAR` API keys)
- **OCR fallback** — PaddleOCR extracts text from bill images for non-vision models (optional)
- **Local document parsing** — Word/PPT/Excel/OpenDocument/RTF/EPUB/CSV/PDF files are converted to Markdown **in your browser** by the [anydoc](https://github.com/firecrawl/anydoc) WebAssembly parser, so office documents never leave your machine

## How it works

favai runs the agent loop **directly in your browser** using [pi-agent-core](https://github.com/earendil-works/pi) + [pi-ai](https://github.com/earendil-works/pi). The LLM agent is embedded in the extension's JavaScript bundle — no external subprocess, no Node.js dependency at runtime.

```
Browser (FavaAI.js)
  ├── pi-agent-core Agent (unified: import + chat)
  ├── pi-ai provider → favai llm_proxy → your LLM API
  ├── propose_transactions tool (import) — updates proposal table
  ├── bql_query tool (chat) — queries fava's built-in BQL API
  ├── anydoc WASM worker — converts office documents/PDFs to Markdown locally
  └── import_confirm → writes entries via fava's existing write path

favai backend (Flask, stateless)
  ├── config (GET/POST) — provider settings
  ├── ingest (POST) — file/text processing (text/image/PDF, anydoc fallback)
  ├── llm_proxy (POST) — forwards LLM requests with injected API key
  └── import_confirm (POST) — validates and writes entries to ledger
```

## Installation

### Prerequisites

- Python >= 3.12
- Fava >= 1.30.14
- An LLM API key (OpenAI, Anthropic, or any compatible endpoint)

### Install from PyPI

```bash
pip install favai
```

With OCR fallback for image-based bills:

```bash
pip install "favai[ocr]"
```

### Install from source (development)

```bash
# Clone the repo
git clone https://github.com/theodoretsui/favai.git
cd favai

# Install Python dependencies
uv sync

# Build the frontend
cd frontend && npm install && npm run build && cd ..
```

`src/favai/FavaAI.js` is generated and intentionally not tracked by Git.
Release CI builds it before creating the wheel and source distribution, so
installing the published package does not require Node.js.

### Configure Fava

Add the extension to your Beancount file:

```
2026-01-01 custom "fava-extension" "favai"
```

The extension page will appear at `/<your-ledger>/extension/FavaAI/`.

### Optional: OCR support

```bash
pip install "favai[ocr]"
# or: uv sync --extra ocr
```

### Optional: backend document parsing

Office documents and PDFs are parsed **in the browser** by the bundled anydoc
WebAssembly parser, so the backend usually never sees them. If you want the
backend `ingest` endpoint to parse them too (e.g. when browser-side parsing is
unavailable), install the optional anydoc binding:

```bash
pip install "favai[anydoc]"
# or: uv sync --extra anydoc
```

## Usage

### 1. Configure an LLM provider

Click the gear icon (top-right) and enter:
- Provider name: any unique name for the endpoint
- API type: `OpenAI Compatible` or `Anthropic Compatible`
- Base URL: your endpoint (e.g. `https://api.openai.com/v1` or a custom proxy)
- Supported models: one or more model identifiers (e.g. `gpt-4o`, `claude-sonnet-4-6`)
- API Key: a literal key or an `$ENV_VAR` reference (recommended)

Use **Fetch models** to load options from the provider's Models API, or type a
model identifier directly into the multi-select and press Enter. Add another
provider with the `+` button; delete a configured provider from its dropdown
action. A model can be selected above the chat before the first message. The
selected model is stored with the session and cannot be changed after that
session starts, which keeps multimodal message history compatible with the
model that created it.

Provider settings are stored as a list in `.favai/config.json`.
**Save** writes or replaces only the selected provider. Every saved provider
and its selected model list then appears in the new-session model selector.

### 2. Import bills

In the chat interface, paste text or upload files (`.txt`, `.md`, `.csv`, `.json`, images, `.pdf`, `.doc/.docx`, `.xls/.xlsx`, `.ppt/.pptx`, `.odt/.ods/.odp`, `.rtf`, `.epub`, …) and press Enter. Office documents and text-layer PDFs are converted to Markdown locally by the anydoc WebAssembly parser before anything is uploaded; images and plain-text files go through the backend pipeline (vision / OCR / text decode) as before. The LLM agent extracts transactions and presents them in an editable table. You can:

- Edit cells directly in the table
- Send natural-language feedback ("change this one to Dining")
- Confirm to write, or discard

### 3. Chat with your ledger

Type questions like:
- "What was my food spend last month?"
- "Show me all transactions to Alipay in July"
- "How much did I spend on utilities this year?"

The agent translates your questions into BQL queries and summarises the results.

## Security

- API keys are stored next to your Beancount file in `.favai/config.json` (git-ignored by default)
- Environment variable references are recommended: `$MY_API_KEY`
- The browser never has access to the real API key — LLM requests pass through the backend proxy
- No file-system or shell access is granted to the LLM agent (only the registered tools)

## Development

```bash
# Install dependencies
make deps

# Run tests
make test

# Lint
make lint

# Build frontend
make build

# Serve the example ledger
make run
```

See also `AGENTS.md` for architecture details and code conventions.

## License

favai is licensed under the [MIT License](LICENSE).
