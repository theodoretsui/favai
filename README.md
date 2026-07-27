# favai

AI-powered bill import and ledger analysis extension for [Fava](https://github.com/beancount/fava), the web frontend for [Beancount](https://beancount.github.io/) double-entry accounting.

## Features

- **Import bills** — paste bank statement text, upload screenshots or PDFs, and let an LLM agent extract transactions and map them to your ledger accounts
- **Chat with your ledger** — ask questions in natural language using BQL queries ("What was my food spend this month?")
- **Multi-turn editing** — give feedback to refine the proposed transactions before writing
- **Any LLM provider** — OpenAI-compatible or Anthropic-compatible APIs (supports custom endpoints and `$ENV_VAR` API keys)

## How it works

favai runs the agent loop **directly in your browser** using [pi-agent-core](https://github.com/earendil-works/pi) + [pi-ai](https://github.com/earendil-works/pi). The LLM agent is embedded in the extension's JavaScript bundle — no external subprocess, no Node.js dependency at runtime.

```
Browser (FavaAI.js)
  ├── pi-agent-core Agent (per-tab: import / chat)
  ├── pi-ai provider → favai llm_proxy → your LLM API
  ├── propose_transactions tool (import) — updates proposal table
  ├── bql_query tool (chat) — queries fava's built-in BQL API
  └── import_confirm → writes entries via fava's existing write path

favai backend (Flask, stateless)
  ├── config (GET/POST) — provider settings
  ├── ingest (POST) — file/text processing (text/image/PDF)
  ├── llm_proxy (POST) — forwards LLM requests with injected API key
  └── import_confirm (POST) — validates and writes entries to ledger
```

## Installation

### Prerequisites

- Python ≥ 3.14
- Fava ≥ 1.30.14
- An LLM API key (OpenAI, Anthropic, or any compatible endpoint)

### Setup

```bash
# Install with uv
uv pip install favai

# Or using pip with the source
pip install favai
```

### Configure Fava

Add the extension to your Beancount file:

```
2026-01-01 custom "fava-extension" "favai"
```

The extension page will appear at `/<your-ledger>/extension/FavaAI/`.

### Build the frontend (development only)

```bash
cd frontend
npm install
npm run build   # builds src/favai/FavaAI.js
```

## Usage

### 1. Configure an LLM provider

Open the **Settings** tab and enter:
- API type: `OpenAI Compatible` or `Anthropic Compatible`
- Base URL: your endpoint (e.g. `https://api.openai.com/v1` or a custom proxy)
- Model: the model identifier (e.g. `gpt-4o`, `claude-sonnet-4-6`)
- API Key: a literal key or an `$ENV_VAR` reference (recommended)

### 2. Import bills

Switch to the **Import** tab, paste text or upload files (`.txt`, `.csv`, `.png`, `.jpg`, `.pdf`, etc.), and click **Start import**. The LLM agent extracts transactions and presents them in an editable table. You can:

- Edit cells directly in the table
- Send natural-language feedback ("change this one to Dining")
- Confirm to write, or discard

### 3. Chat with your ledger

Switch to the **Chat** tab and ask questions like:
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
