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

# Builds the web app and serves the static files with nginx.
#   docker compose up --build        ->  http://localhost:8080
# Optional: embed a default Gemini key (it ends up in the public JavaScript):
#   VITE_GEMINI_API_KEY=... docker compose up --build

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Puppeteer is only used by the test suite; skip its Chrome download.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy dependency manifests
COPY package*.json tsconfig.json vite.config.ts ./

# Install dependencies
RUN npm ci

# Copy source code and files
COPY index.html ./
COPY src/ ./src

# Build for production
ARG VITE_GEMINI_API_KEY=""
RUN VITE_GEMINI_API_KEY="$VITE_GEMINI_API_KEY" npm run build

# Serve stage
FROM nginx:alpine

# Copy built static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose standard HTTP port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
