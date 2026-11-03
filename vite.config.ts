/*
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { defineConfig, loadEnv } from 'vite';
import { createApiMiddleware } from './src/server';

export default defineConfig(({ command, mode }) => {
  const apiMiddleware = createApiMiddleware(process.cwd());
  const env = command === 'build' ? loadEnv(mode, process.cwd(), '') : {};
  const buildInjectedGeminiKey =
    command === 'build'
      ? (
          env.VITE_GEMINI_API_KEY ||
          env.GEMINI_API_KEY ||
          env.GOOGLE_API_KEY ||
          env.API_KEY ||
          process.env.VITE_GEMINI_API_KEY ||
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          process.env.API_KEY ||
          ''
        ).trim()
      : '';

  return {
    root: '.',
    base: './',
    define: {
      __AD_SCRIPT_ASSIST_GEMINI_API_KEY__: JSON.stringify(buildInjectedGeminiKey),
    },
    server: {
      allowedHosts: true,
    },
    preview: {
      allowedHosts: true,
    },
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      exclude: ['kokoro-js', '@huggingface/transformers', 'onnxruntime-web'],
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    plugins: [
      {
        name: 'ad-script-assist-server-api',
        configureServer(server) {
          server.middlewares.use(apiMiddleware);
        },
        configurePreviewServer(server) {
          server.middlewares.use(apiMiddleware);
        },
      },
    ],
  };
});
