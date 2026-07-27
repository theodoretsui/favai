PYTHON := uv run

.PHONY: deps build test lint dev run

deps: ## Install Python and frontend dependencies
	uv sync
	cd frontend && npm install

build: ## Build the frontend bundle into src/favai/FavaAI.js
	cd frontend && npm run build

test: ## Run Python unit tests
	$(PYTHON) pytest tests/ -q

lint: ## Ruff lint + format check
	$(PYTHON) ruff check src tests
	$(PYTHON) ruff format --check src tests

run: ## Serve the example ledger
	$(PYTHON) fava example/example.beancount -p 5500

dev: ## fava --debug + vite watch (requires two terminals or `&`)
	$(PYTHON) fava --debug example/example.beancount -p 5500 & cd frontend && npm run dev
