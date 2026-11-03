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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const builtServerPath = path.join(rootDir, 'dist', 'server', 'server.mjs');
const isProd =
  process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);

async function main() {
  if (isProd && fs.existsSync(builtServerPath)) {
    const mod = await import('./dist/server/server.mjs');
    if (typeof mod.startServer === 'function') {
      mod.startServer(Number(process.env.PORT) || 3000, rootDir);
    }
    return;
  }

  try {
    const { createServer } = await import('vite');
    const port = Number(process.env.PORT) || 3000;
    const server = await createServer({
      root: rootDir,
      server: {
        host: '0.0.0.0',
        port,
        allowedHosts: true,
      },
    });
    await server.listen();
    server.printUrls();
  } catch (err) {
    if (fs.existsSync(builtServerPath)) {
      const mod = await import('./dist/server/server.mjs');
      if (typeof mod.startServer === 'function') {
        mod.startServer(Number(process.env.PORT) || 3000, rootDir);
        return;
      }
    }
    throw err;
  }
}

main();
