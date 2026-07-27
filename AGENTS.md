# favai — AI-powered bill import extension for Fava

## Project Overview

favai is a [Fava](https://github.com/beancount/fava) extension (named `FavaAI`)
that lets users import bank/credit-card bills into their beancount ledger with
the help of an LLM agent, and chat with their ledger in natural language.

The agent loop runs **directly in the browser** using
[pi-agent-core](https://github.com/earendil-works/pi) +
[pi-ai](https://github.com/earendil-works/pi) — no external subprocess,
no Node.js dependency.  LLM requests pass through a thin backend proxy
that injects the real API key.

**Features:**
- Import bills via text paste, screenshots (PNG/JPEG/WebP) or PDFs
- Multi-turn conversation to refine proposed transactions
- Chat agent with BQL query tool for ledger analysis
- Configurable for any OpenAI-compatible or Anthropic-compatible provider

**Language:** Python 3.14+ / TypeScript (frontend + pi-agent-core tools)  
**License:** Not specified (check `pyproject.toml`)

---

## Directory Layout

```
favai/
├── pyproject.toml           # Python project metadata, dependencies, build config (hatchling)
├── Makefile                 # Common dev commands (deps, test, lint, build, dev, run)
├── uv.lock                  # uv lockfile (deterministic Python dependency resolution)
├── .python-version          # Python version pin (3.14)
├── .gitignore               # Python build artifacts, .venv, frontend node_modules, .favai/
│
├── src/favai/               # Python extension package (installed by pip/uv)
│   ├── __init__.py          # FavaAI extension class (Flask endpoints — stateless)
│   ├── config.py            # LLM provider config (config.json read/write, masking, $ENV_VAR)
│   ├── entries.py           # Transaction dict → fava deserialisation shape conversion
│   ├── ingest.py            # File upload processing (text, images, PDF text extraction)
│   ├── proxy.py             # LLM request forwarder (injects API key, streams bytes)
│   ├── FavaAI.js            # Frontend build artifact (committed in git, ~1.5 MB minified)
│   ├── templates/
│   │   └── FavaAI.html      # fava extension page mount point (<div id="favaiApp">)
│
├── frontend/                # Vite + React 19 + Tailwind v4 + shadcn/ui frontend
│   ├── package.json         # npm dependencies (react 19, shadcn, pi-agent-core, pi-ai...)
│   ├── package-lock.json    # npm lockfile
│   ├── vite.config.ts       # Vite lib build → src/favai/FavaAI.js (CSS inlined, minified)
│   ├── tsconfig.json        # TypeScript strict config (ES2022, bundler resolution)
│   ├── components.json      # shadcn/ui configuration
│   └── src/
│       ├── extension.ts     # Entry point: fava's onExtensionPageLoad() hook
│       ├── App.tsx          # Root React component (tab switcher: Import / Chat / Settings)
│       ├── api.ts           # Backend API client (typed fetch wrapper)
│       ├── i18n.ts          # Tiny i18n (zh-CN default, English fallback)
│       ├── index.css        # Scoped Tailwind CSS (no preflight; all vars under .favai-root)
│       ├── vite-env.d.ts    # Vite client type references
│       ├── lib/
│       │   ├── utils.ts     # cn() utility (clsx + tailwind-merge)
│       │   └── portal.ts    # Portal container setter (keeps floating UI inside .favai-root)
│       ├── agent/           # pi agent infrastructure (browser-embedded)
│       │   ├── fetchShim.ts # Sentinel-domain fetch wrapper → llm_proxy endpoint
│       │   ├── provider.ts  # buildModels() — create pi-ai Models from favai Config
│       │   ├── factory.ts   # createImportAgent() / createChatAgent()
│       │   ├── prompts.ts   # System prompts (import rules + chat assistant)
│       │   ├── favaApi.ts   # getLedgerData(), runQuery(), flattenTable()
│       │   └── tools/
│       │       ├── importTool.ts  # propose_transactions tool (TypeBox schema)
│       │       └── bqlTool.ts     # bql_query tool (fava BQL API)
│       └── components/
│           ├── ImportTab.tsx         # Import workflow (ingest → agent → proposal table)
│           ├── ChatTab.tsx           # Chat agent UI (streaming messages + tool indicators)
│           ├── SettingsTab.tsx       # LLM provider configuration form
│           ├── ProposalTable.tsx     # Editable transaction proposal table
│           ├── AccountCombobox.tsx   # Searchable account picker
│           └── ui/                  # shadcn/ui primitives (button, input, table, combobox, etc.)
│
├── tests/                   # Python unit tests (pytest)
│   ├── test_config.py       # ProviderConfig validation, serialisation, masking
│   ├── test_entries.py      # Transaction → fava entry conversion, validation
│   ├── test_ingest.py       # File upload classification, PDF/text/image handling
│   └── test_proxy.py        # _resolve_key, _build_upstream_headers, path validation
│
└── example/
    └── example.beancount    # Demo ledger used with `make run`
```

---

## Technology Stack

### Backend (Python)
- **Python 3.14+** with `from __future__ import annotations` everywhere
- **fava ≥ 1.30.14** (Flask extension API: `FavaExtensionBase`, `extension_endpoint`)
- **pypdf ≥ 5.0** — PDF text extraction
- **httpx ≥ 0.27** — streaming HTTP client for the LLM proxy
- **hatchling** — build system
- **uv** — dependency management

### Frontend (TypeScript / React)
- **React 19.1**, React DOM 19.1
- **TypeScript 5.8** (strict, ES2022 target, bundler module resolution)
- **shadcn/ui** (radix-nova style) with Base UI React 1.6
- **Tailwind CSS 4.1** (no preflight, scoped under `.favai-root`)
- **Vite 7** (lib mode: single `FavaAI.js` with inlined CSS, minified)
- **pi-agent-core 0.81.1** — Agent class (tool execution, streaming events)
- **pi-ai 0.81.1** — Models/Provider/streamSimple (OpenAI + Anthropic SDKs)
- **typebox** — Tool parameter JSON schema validation
- **lucide-react** icons, **sonner** toasts
- **clsx** + **tailwind-merge** (cn() helper)

### No External Runtime
The agent runs in the browser — **no Node.js or `pi` CLI dependency** at runtime.
`npm` is only needed for frontend development builds.

---

## Key Architecture Decisions

### Browser-Embedded Agent Loop

Instead of spawning a `pi --mode rpc` subprocess, the agent loop runs in the
browser using `@earendil-works/pi-agent-core`.  This eliminates:
- The Node.js runtime dependency for end users
- Subprocess lifecycle management (stdin/stdout JSONL, 300s timeouts, zombie processes)
- The single-session lock (multiple agents can coexist per tab)

**Tool execution** happens fully on the frontend:
- `propose_transactions` — updates React state directly (no backend needed)
- `bql_query` — `fetch()` to fava's built-in `GET /<slug>/api/query/` endpoint

### LLM Proxy (``llm_proxy``)

pi-ai's provider SDKs construct URLs by appending paths (e.g.
`/chat/completions` for OpenAI, `/v1/messages` for Anthropic).  Fava's
extension endpoints use single-segment routes (`/<endpoint>`, no slashes).
To bridge this:

1. pi-ai `Model.baseUrl` is set to a sentinel domain (`https://favai-proxy.invalid`)
2. A **global `fetch` shim** intercepts requests to the sentinel domain,
   rewrites them to the favai `llm_proxy` extension endpoint, and puts the
   original path in the `X-Favai-Upstream` header
3. The backend proxy strips hop-by-hop headers, injects the real API key
   (resolving `$ENV_VAR` references), and streams the upstream response bytes
   back via `Flask.Response(stream_with_context(...), direct_passthrough=True)`

### Security

- API keys are stored in `.favai/config.json` next to the beancount file
  (git-ignored).  `$ENV_VAR` references are recommended over literal keys.
- The `to_public_dict()` method masks literal keys (`sk-****`) before sending
  to the frontend.
- **The browser never has access to the real API key** — the `llm_proxy`
  endpoint injects it server-side.
- Tools have no file-system or shell access (pure data-in/data-out).
- BQL queries from the chat agent are read-only by construction (Beancount
  BQL has no write statements).

### Configuration

favai stores its config in `.favai/` next to the beancount file (one
`config.json` only — no `models.json` since there is no pi subprocess).

### Style Isolation

Fava provides only a JS channel for extensions (no separate CSS).  The frontend:
- Inlines all CSS into `FavaAI.js` via `?inline` import
- Injects a `<style data-favai>` element at runtime
- Uses `.favai-root` scoping for all CSS variables and resets
- Redirects all portals to the extension root element, not `<body>`

---

## Build & Test Commands

All commands use the `Makefile` at the project root:

| Command | Description |
|---------|-------------|
| `make deps` | `uv sync` + `cd frontend && npm install` |
| `make test` | Run pytest unit tests (`tests/ -q`) |
| `make lint` | `ruff check` + `ruff format --check` on `src` and `tests` |
| `make build` | Build the frontend bundle (`cd frontend && npm run build`) → overwrites `src/favai/FavaAI.js` |
| `make dev` | Start fava (debug) + Vite watch (needs two terminals or `&`) |
| `make run` | Serve `example/example.beancount` with fava |

### Frontend build specifics
- `vite.config.ts` builds in **lib mode** — single ES module output.
- `cssCodeSplit: false` — everything inlined.
- `inlineDynamicImports: true` — pi-ai's lazy SDK imports bundled inline.
- Output goes directly to `src/favai/FavaAI.js` (committed in git, ~1.5 MB).
- CI checks: `make build && git diff --exit-code` ensures the built JS matches source.

---

## Testing Strategy

- **Pure Python unit tests** (no fava instance, no file system side effects for most tests).
- Tests are in `tests/` and mirror the module structure (`test_config.py` → `favai.config`).
- **pytest** is the test runner. Tests use:
  - `tmp_path` fixture for temporary config files
  - `monkeypatch` for mocking httpx and env vars in proxy tests
  - `@pytest.mark.parametrize` for validation test tables
- No frontend unit tests yet (only the CI build-idempotency check).
- E2E testing uses a Python stub server (`/tmp/openai_stub.py`) + agent-browser.

### Running a single test
```bash
uv run pytest tests/test_config.py -q
uv run pytest tests/test_proxy.py::test_openai_auth_header
```

---

## Code Style & Conventions

### Python
- **Python 3.14+** — uses `from __future__ import annotations` (PEP 604 syntax everywhere).
- **Ruff** for linting and formatting (configured in `pyproject.toml`). Run `make lint` to check.
- Import order: standard library → third-party → first-party.
- Error messages in **Chinese** (用户面消息) for most user-facing strings; technical/protocol errors in English.
- Custom exceptions: `ConfigError`, `ProxyError`, `EntryError` (all inherit `ValueError`).
- `api_response` decorator wraps JSON endpoints with `{success: true, data}` / `{success: false, error}`.
  The `llm_proxy` endpoint does **not** use `api_response` — it returns the upstream response raw.
- `from __future__ import annotations` is the first import in every module.

### TypeScript / Frontend
- **Strict TypeScript** (`noUnusedLocals`, `noUnusedParameters`, `strict`, `verbatimModuleSyntax`).
- React 19 idioms (no class components, no deprecated lifecycle methods).
- CSS scoped under `.favai-root` — never add bare selectors or `:root` variables.
- i18n via a simple `t()` function with two dictionaries (zh-CN + en). New UI strings must be added to both dictionaries.
- Tool `execute` functions must **throw** on error (agent catches and reports as `isError`).
  Do not return error messages as content.

### Project-specific Conventions
- The built `src/favai/FavaAI.js` is committed to git. Do **not** edit it by hand — always `make build`.
- All `Edit`-like operations on the proposal pass through pure functions that produce new immutable arrays.
- The Python package is a flat namespace (`favai.*`); no nested subpackages.

---

## Dependencies & Tools Required

### Runtime (end user)
- **Python ≥ 3.14** with **fava ≥ 1.30.14** and **httpx ≥ 0.27**
- LLM provider (any OpenAI-compatible or Anthropic-compatible API)
- No Node.js or `pi` runtime needed.

### Development
- `uv` (Python package manager)
- `Node.js ≥ 18` and `npm` (for developing the frontend bundle)
- `pytest`, `ruff` (installed via uv dev deps)
- `agent-browser` (npm) for E2E testing with browser automation
- A beancount file with `2026-01-01 custom "fava-extension" "favai"` to load the extension

---

## Data Flow

### Import flow

```
Browser (FavaAI.js)
  │ User pastes text / uploads files
  ▼
1. POST /ingest (multipart) → ingest.py classifies files, returns texts + images
  │
2. Build prompt from #ledger-data (accounts, currencies, payees) + ingest result
  │
3. createImportAgent(config, onProposal)
   └─ pi-agent-core Agent + propose_transactions tool
  │
4. agent.prompt(prompt, images)
   └─ pi-ai builds provider request → fetch shim rewrites to /llm_proxy
      └─ backend proxy forwards to user-configured LLM, injects API key
         └─ pi-ai SDK processes streaming SSE → agent detects tool call
            └─ propose_transactions.execute() calls onProposal(transactions)
  │
5. Proposal table populates → user edits or sends feedback
  │
6. User clicks "Confirm & write"
   └─ POST /import_confirm ({transactions})
      └─ to_fava_entries() → deserialise() → ledger.file.insert_entries()

User clicks "Discard"
   └─ agent.abort() + reset state (no backend call needed)
```

### Chat flow

```
Browser (FavaAI.js)
  │ User types a question (e.g. "What was my food spend?")
  ▼
1. createChatAgent(config)
   └─ pi-agent-core Agent + bql_query tool + CHAT_SYSTEM_PROMPT
  │
2. agent.prompt(question)
   └─ pi-ai → llm_proxy → LLM → tool_call: bql_query
      └─ bql_query.execute() → fetch /<slug>/api/query/?query_string=...
         → flattenTable() → result text
   └─ Agent sends tool result back to LLM → LLM summarises → text_delta events
  │
3. Streaming text rendered in ChatTab via agent.subscribe (message_update / text_delta)
```

---

## Limitations & Notes

- **Token consumption**: The full account tree is injected into every import prompt.
  Very large ledgers may consume significant token budgets.
- **PDF**: Only text-layer PDFs are supported. Scanned PDFs produce a warning
  suggesting screenshots instead.
- **Fetch shim is global**: The sentinel-domain `fetch` wrapper is installed at
  module load time. Only requests to `https://favai-proxy.invalid` are intercepted;
  all other `fetch` calls pass through unchanged.
- **Chat history**: Agent state is in browser memory only; refresh clears the
  conversation. Persistence to `.favai/sessions/` is a future enhancement.
- The `.favai/` directory (next to the beancount file) is git-ignored.
