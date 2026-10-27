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

.PHONY: all setup build dev start serve clean make-for-aistudio

# Default target
all: build

# Install dependencies
setup:
	npm install

# 1. Build with Vite
build:
	@echo "Building with Vite..."
	npm run build

# 2. Run a local development server with Vite (hot reload)
dev:
	@echo "Starting Vite dev server..."
	npm run dev

start: dev

# Build and run a local server (production preview)
serve: build
	@echo "Starting Vite production preview..."
	npx vite preview

clean:
	rm -rf dist ad-script-assist-aistudio.zip

# Create a clean zip archive of tracked files for Google AI Studio import
make-for-aistudio:
	@echo "Creating clean archive ad-script-assist-aistudio.zip for Google AI Studio..."
	git archive --format=zip --output=ad-script-assist-aistudio.zip HEAD
	@ls -lh ad-script-assist-aistudio.zip
