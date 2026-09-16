.PHONY: all build dev serve

# Default target
all: build

# 1. Build with Vite
build:
	@echo "Building with Vite..."
	npm run build

# 2. Run a local development server with Vite (hot reload)
dev:
	@echo "Starting Vite dev server..."
	npm run dev

# Build and run a local server (production preview)
serve: build
	@echo "Starting Vite production preview..."
	npx vite preview
