PYTHON := uv run

.PHONY: deps build test lint dev run

deps: ## Install Python (with OCR extra) and frontend dependencies
	uv sync --extra ocr
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

dev: ## Run fava --debug and vite watch together
	cd frontend && npx --no-install concurrently --kill-others --names fava,vite \
	"cd .. && $(PYTHON) fava --debug example/example.beancount -p 5500" \
	"npm run dev"
