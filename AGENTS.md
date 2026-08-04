# favai — AI Agent Extension for Fava

## Project Overview

favai is a Fava extension named `FavaAI`. It uses an LLM agent to make
Beancount ledgers easier to operate: users can import bills from text, images,
or PDFs, refine proposed transactions through conversation, and analyze their
ledger with natural-language questions.

The agent loop runs in the browser with `pi-agent-core` and `pi-ai`. A small
Python backend handles Fava integration, file ingestion, optional OCR, and LLM
proxying so API keys are never exposed to the browser. End users do not need
Node.js; it is only used to build the frontend.

## Technology Stack

- Backend: Python >= 3.12, Fava, httpx, pypdf, and optional PaddleOCR.
- Frontend: TypeScript, React, Tailwind CSS, shadcn/ui, Vite,
  `pi-agent-core`, and `pi-ai`.
- Tooling: uv and hatchling for Python; npm and Vite for the frontend;
  pytest and Ruff for verification.
- Packaging: the frontend is bundled into `src/favai/FavaAI.js`, then included
  in the Python wheel and source distribution.

## Architecture and Security

- One browser-embedded agent handles bill import and ledger chat using the
  `propose_transactions`, `bql_query`, and `today` tools.
- LLM requests are intercepted by the frontend fetch shim and forwarded through
  the backend `llm_proxy`, which injects the configured API key.
- Literal keys are masked before configuration is returned to the frontend;
  `$ENV_VAR` references are preferred.
- BQL access is read-only. Agent tools have no shell or filesystem access.
- Configuration lives in `.favai/config.json` next to the ledger and must stay
  out of version control.
- Frontend styles and portals must remain scoped to `.favai-root`.

## Development Workflow — Mandatory

These rules apply to every contributor and coding agent:

1. Never develop or commit directly on `main`. Before changing any file, create
   a branch from the latest `main`, using an appropriate prefix such as
   `feature/`, `fix/`, `docs/`, or `release/` (coding agents may use their
   required `codex/` prefix).
2. Keep each branch focused on one change. Commit and push only to that branch.
3. Open a pull request targeting `main`. All changes, including README,
   AGENTS.md, CI, and release metadata changes, must go through a PR.
4. Wait for the required CI check (`Test, lint, and build`) and the repository
   owner's review. Address feedback on the same branch.
5. A coding agent must never approve its own PR, bypass branch protection,
   reduce review requirements, enable an admin bypass, or merge a PR unless the
   repository owner explicitly instructs it to merge that specific reviewed PR.
   Creating a PR or being asked to commit/push is not permission to merge.
6. If work starts while checked out on `main`, stop and create a branch before
   editing. If uncommitted user changes prevent this safely, ask the user rather
   than moving, discarding, or overwriting them.

Normal development flow:

```text
feature/*, fix/*, docs/*, or codex/*
  -> pull request to main
  -> CI passes
  -> owner review/approval
  -> merge to main
  -> no package release unless the project version was intentionally bumped
```

## CI and Release Workflow

### Pull-request CI

`.github/workflows/ci.yml` runs for every PR to `main`. It installs frontend
dependencies, builds the frontend bundle, runs Python tests and Ruff, builds
the wheel and source distribution, verifies that both packages contain the
frontend bundle, and validates package metadata. Do not weaken, skip, or work
around these checks.

### Ordinary changes

Documentation, tests, refactors, and features that are not releases must keep
`project.version` in `pyproject.toml` unchanged. In particular, README-only or
AGENTS.md-only PRs must not bump the version and therefore must not publish a
new package.

### Publishing a release

Releases must use a dedicated `release/*` branch and PR:

1. Decide the next semantic version with the repository owner.
2. Update `project.version` in `pyproject.toml` and include all intended release
   notes or metadata in the same release PR.
3. Run the normal checks, push the release branch, and open a PR to `main`.
4. Wait for CI and owner review. A coding agent must not merge the release PR
   without an explicit instruction for that specific PR.
5. After the reviewed PR is merged, `.github/workflows/publish.yml` builds the
   wheel and sdist, publishes them to PyPI through Trusted Publishing, creates
   the `v<version>` Git tag, and creates a GitHub Release with the artifacts.
6. Confirm the workflow, PyPI version, Git tag, and GitHub Release all succeeded.

The current workflow is path-triggered by changes to `pyproject.toml`, while
the version is the package identity checked by PyPI. Therefore, do not edit
`pyproject.toml` casually: combine non-release metadata changes with the next
intentional version bump, or update the workflow first if different release
semantics are required. Never retry publishing an existing version; bump the
version through another reviewed release PR.

## Build and Test Commands

| Command | Purpose |
| --- | --- |
| `make deps` | Install Python and frontend dependencies |
| `make test` | Run Python tests |
| `make lint` | Run Ruff checks |
| `make build` | Type-check and rebuild the frontend bundle |
| `uv build` | Build wheel and source distribution |
| `uvx twine check dist/*` | Validate package metadata |
| `make dev` | Run Fava and the frontend watcher for development |
| `make run` | Serve the example ledger |

Run checks relevant to the change before pushing. Frontend changes require
`make build` locally. The generated `src/favai/FavaAI.js` is ignored by Git and
must not be committed; CI builds it before packaging. Never edit that generated
file by hand.

## Code Conventions

### Python

- Use `from __future__ import annotations`, modern type hints, and Ruff.
- Keep imports ordered standard library, third-party, then first-party.
- User-facing errors are generally Chinese; protocol errors may be English.
- Preserve the raw streaming behavior of `llm_proxy`; JSON endpoints use the
  existing `api_response` response shape.

### TypeScript and React

- Keep strict TypeScript clean, including unused-symbol checks.
- Add new UI strings to both zh-CN and English dictionaries.
- Keep CSS under `.favai-root`; do not add global resets or `:root` variables.
- Tool `execute` functions must throw on failure so the agent records an error.
- Treat the agent transcript as the source of truth for displayed messages.
- Use immutable updates for proposal edits.

## Known Constraints

- Large account trees increase prompt token usage.
- Text-layer PDFs are supported; scanned PDFs should be supplied as images.
- Conversation history is browser-memory-only and is cleared on refresh.
- The global fetch shim must intercept only `https://favai-proxy.invalid`.
