PYTHON := uv run

.PHONY: deps build test test-e2e lint dev run

deps: ## Install Python (with OCR extra) and frontend dependencies
	uv sync --extra ocr
	cd frontend && npm install

build: ## Build the frontend bundle into src/favai/FavaAI.js
	cd frontend && npm run build

test: ## Run Python unit tests
	$(PYTHON) pytest tests/ -q

test-e2e: build ## Run browser E2E tests (requires agent-browser)
	bash e2e/test_pure_image_thumbnail.sh
	bash e2e/test_tool_result_bubble.sh
	bash e2e/test_proposal_warning.sh
	bash e2e/test_approval_inline.sh

lint: ## Ruff lint + format check
	$(PYTHON) ruff check src tests e2e/openai_stub.py
	$(PYTHON) ruff format --check src tests e2e/openai_stub.py

run: ## Serve the example ledger
	$(PYTHON) fava example/example.beancount -p 5500

dev: ## Run fava --debug and vite watch together
	cd frontend && npx --no-install concurrently --kill-others --names fava,vite \
	"cd .. && $(PYTHON) fava --debug example/example.beancount -p 5500" \
	"npm run dev"
