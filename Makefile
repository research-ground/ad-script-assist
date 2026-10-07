# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
