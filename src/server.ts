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

import { GoogleGenAI } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SERVER_KEY_PREFIX = '__SERVER_KEY:';
export const SERVER_KEY_ENV_PREFIX = '__SERVER_KEY_ENV:';
export const SERVER_KEY_SUFFIX = '__';

const MAX_PROXY_BODY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB to support 1 GB+ local video blobs
const MAX_INLINE_VIDEO_BYTES = 14 * 1024 * 1024; // 14 MB raw (~18.7 MB base64, safely under Gemini's 20 MB inline limit)
const UPLOAD_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHED_UPLOADS = 5;

interface UploadedVideoEntry {
  chunks: Buffer[];
  receivedCount: number;
  totalChunks: number;
  buffer?: Buffer;
  mimeType: string;
  createdAt: number;
  geminiFileUri?: string;
  geminiFileMimeType?: string;
}

const uploadedVideos = new Map<string, UploadedVideoEntry>();

function pruneUploadedVideos(): void {
  const now = Date.now();
  for (const [id, entry] of uploadedVideos.entries()) {
    if (now - entry.createdAt > UPLOAD_TTL_MS) {
      uploadedVideos.delete(id);
    }
  }
  while (uploadedVideos.size > MAX_CACHED_UPLOADS) {
    const oldestKey = uploadedVideos.keys().next().value;
    if (oldestKey) {
      uploadedVideos.delete(oldestKey);
    } else {
      break;
    }
  }
}

async function resolveGeminiFileUri(
  ai: GoogleGenAI,
  entry: UploadedVideoEntry,
  uploadId: string,
): Promise<{ fileUri: string; mimeType: string }> {
  if (entry.geminiFileUri && entry.geminiFileMimeType) {
    return {
      fileUri: entry.geminiFileUri,
      mimeType: entry.geminiFileMimeType,
    };
  }
  if (!entry.buffer) {
    throw new Error('Uploaded video buffer is incomplete.');
  }
  const mimeType = entry.mimeType || 'video/mp4';
  const ext = mimeType.includes('webm')
    ? '.webm'
    : mimeType.includes('quicktime')
      ? '.mov'
      : '.mp4';
  const tmpFile = path.join(
    os.tmpdir(),
    `ad_script_assist_${uploadId.replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`,
  );
  fs.writeFileSync(tmpFile, entry.buffer);
  try {
    let uploaded = await ai.files.upload({
      file: tmpFile,
      config: { mimeType },
    });
    const deadline = Date.now() + 180_000;
    while (uploaded.state === 'PROCESSING' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!uploaded.name) break;
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    if (uploaded.state === 'FAILED') {
      throw new Error('Gemini Files API failed to process the uploaded video.');
    }
    if (!uploaded.uri) {
      throw new Error('Gemini Files API did not return a file URI.');
    }
    entry.geminiFileUri = uploaded.uri;
    entry.geminiFileMimeType = uploaded.mimeType || mimeType;
    return {
      fileUri: entry.geminiFileUri,
      mimeType: entry.geminiFileMimeType,
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore temp file cleanup errors
    }
  }
}

type IniSections = Record<string, Record<string, string>>;

function parseIniText(text: string): IniSections {
  const sections: IniSections = {};
  let currentSection = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim().toLowerCase();
      if (!sections[currentSection]) {
        sections[currentSection] = {};
      }
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(' #');
      if (hashIdx !== -1) {
        val = val.slice(0, hashIdx).trim();
      }
    }
    if (!sections[currentSection]) {
      sections[currentSection] = {};
    }
    sections[currentSection][key] = val;
  }
  return sections;
}

function mergeSections(base: IniSections, override: IniSections): IniSections {
  const result: IniSections = {};
  for (const [sec, values] of Object.entries(base)) {
    result[sec] = { ...values };
  }
  for (const [sec, values] of Object.entries(override)) {
    if (!result[sec]) {
      result[sec] = {};
    }
    for (const [k, v] of Object.entries(values)) {
      result[sec][k] = v;
    }
  }
  return result;
}

function serializeIniSections(sections: IniSections): string {
  const lines: string[] = [];
  for (const [sec, values] of Object.entries(sections)) {
    if (!sec) continue;
    lines.push(`[${sec}]`);
    for (const [k, v] of Object.entries(values)) {
      lines.push(`${k} = ${v}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface ServerConfigSnapshot {
  sections: IniSections;
  realKeys: Record<string, string>;
  envInjectedKeys: Set<string>;
  allowedHosts: Set<string>;
}

/**
 * Reads `models.conf` from `rootDir`, overlaying any host-injected environment
 * variables (`GEMINI_API_KEY`, `API_KEY`, `OPENAI_API_KEY`).
 */
export function loadServerConfig(rootDir = process.cwd()): ServerConfigSnapshot {
  let merged: IniSections = {};
  const fullPath = path.join(rootDir, 'models.conf');
  if (fs.existsSync(fullPath)) {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      merged = mergeSections(merged, parseIniText(content));
    } catch (e) {
      console.warn('Warning: Failed to read models.conf:', e);
    }
  }

  if (!merged['keys']) merged['keys'] = {};
  if (!merged['providers']) merged['providers'] = {};
  if (!merged['models']) merged['models'] = {};

  const envInjectedKeys = new Set<string>();
  const envGemini = (
    process.env['GEMINI_API_KEY'] ||
    process.env['API_KEY'] ||
    ''
  ).trim();
  if (envGemini && !merged['keys']['gemini_api_key']) {
    merged['keys']['gemini_api_key'] = envGemini;
    envInjectedKeys.add('gemini_api_key');
  }

  const envOpenai = (process.env['OPENAI_API_KEY'] || '').trim();
  if (envOpenai && !merged['keys']['openai_api_key']) {
    merged['keys']['openai_api_key'] = envOpenai;
    envInjectedKeys.add('openai_api_key');
  }

  const realKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged['keys'])) {
    if (v && v.trim() !== '') {
      realKeys[k.toLowerCase()] = v.trim();
    }
  }

  const allowedHosts = new Set<string>([
    'generativelanguage.googleapis.com',
    'api.openai.com',
  ]);

  return { sections: merged, realKeys, envInjectedKeys, allowedHosts };
}

function replacePlaceholders(
  input: string,
  realKeys: Record<string, string>,
): string {
  let out = input.replace(
    /__SERVER_KEY(?:_ENV)?:([a-z0-9_]+)__/gi,
    (_match, keyName: string) => {
      const norm = keyName.toLowerCase();
      return realKeys[norm] || '';
    },
  );
  out = out.replace(
    /__SERVER_KEY(?:_ENV)?%3A([a-z0-9_]+)__/gi,
    (_match, keyName: string) => {
      const norm = keyName.toLowerCase();
      return encodeURIComponent(realKeys[norm] || '');
    },
  );
  return out;
}

function readRequestBodyBuffer(
  req: IncomingMessage,
  maxBytes = MAX_PROXY_BODY_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error(`Request body exceeded limit of ${maxBytes} bytes.`));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/**
 * Creates a Connect/Express-compatible middleware handling `GET /api/config`
 * and `POST /api/proxy`.
 */
export function createApiMiddleware(rootDir = process.cwd()) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> => {
    const reqUrl = req.url || '';
    const pathname = reqUrl.split('?')[0];

    if (req.method === 'GET' && pathname === '/api/config') {
      const { sections, realKeys, envInjectedKeys } = loadServerConfig(rootDir);
      const redacted: IniSections = {};
      for (const [sec, values] of Object.entries(sections)) {
        if (sec === 'keys') {
          redacted['keys'] = {};
          for (const k of Object.keys(values)) {
            const norm = k.toLowerCase();
            if (realKeys[norm]) {
              const prefix = envInjectedKeys.has(norm)
                ? SERVER_KEY_ENV_PREFIX
                : SERVER_KEY_PREFIX;
              redacted['keys'][norm] = `${prefix}${norm}${SERVER_KEY_SUFFIX}`;
            } else {
              redacted['keys'][norm] = '';
            }
          }
        } else {
          redacted[sec] = { ...values };
        }
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(serializeIniSections(redacted));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/upload-chunk') {
      pruneUploadedVideos();
      let rawBody: Buffer;
      try {
        rawBody = await readRequestBodyBuffer(req, 16 * 1024 * 1024);
      } catch (e) {
        sendJson(res, 413, {
          error: {
            code: 413,
            message: e instanceof Error ? e.message : 'Chunk too large.',
          },
        });
        return;
      }

      let chunkPayload: {
        uploadId?: string;
        chunkIndex?: number;
        totalChunks?: number;
        mimeType?: string;
        data?: string;
      };
      try {
        chunkPayload = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        sendJson(res, 400, {
          error: { code: 400, message: 'Invalid JSON in /api/upload-chunk.' },
        });
        return;
      }

      const { uploadId, chunkIndex, totalChunks, mimeType, data } = chunkPayload;
      if (
        !uploadId ||
        typeof chunkIndex !== 'number' ||
        typeof totalChunks !== 'number' ||
        totalChunks < 1 ||
        chunkIndex < 0 ||
        chunkIndex >= totalChunks ||
        typeof data !== 'string'
      ) {
        sendJson(res, 400, {
          error: { code: 400, message: 'Invalid chunk parameters.' },
        });
        return;
      }

      let entry = uploadedVideos.get(uploadId);
      if (!entry || entry.totalChunks !== totalChunks) {
        entry = {
          chunks: new Array<Buffer>(totalChunks),
          receivedCount: 0,
          totalChunks,
          mimeType: mimeType || 'video/mp4',
          createdAt: Date.now(),
        };
        uploadedVideos.set(uploadId, entry);
      }
      entry.createdAt = Date.now();
      if (mimeType) {
        entry.mimeType = mimeType;
      }
      if (!entry.chunks[chunkIndex]) {
        entry.receivedCount += 1;
      }
      entry.chunks[chunkIndex] = Buffer.from(data, 'base64');

      if (entry.receivedCount === totalChunks) {
        entry.buffer = Buffer.concat(entry.chunks);
        entry.chunks = [];
      }

      sendJson(res, 200, {
        ok: true,
        uploadId,
        ready: Boolean(entry.buffer),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/proxy') {
      const { realKeys, allowedHosts } = loadServerConfig(rootDir);

      let rawBody: Buffer;
      try {
        rawBody = await readRequestBodyBuffer(req);
      } catch (e) {
        sendJson(res, 413, {
          error: e instanceof Error ? e.message : 'Payload too large.',
        });
        return;
      }

      let payload: {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        isBase64Body?: boolean;
      };
      try {
        payload = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body in /api/proxy request.' });
        return;
      }

      const rawUrl = payload?.url;
      if (!rawUrl || typeof rawUrl !== 'string') {
        sendJson(res, 400, { error: 'Missing target url in /api/proxy request.' });
        return;
      }

      const resolvedUrl = replacePlaceholders(rawUrl, realKeys);
      let parsedTarget: URL;
      try {
        parsedTarget = new URL(resolvedUrl);
      } catch {
        sendJson(res, 400, { error: 'Invalid target URL.' });
        return;
      }

      if (
        (parsedTarget.protocol !== 'https:' &&
          parsedTarget.protocol !== 'http:') ||
        !allowedHosts.has(parsedTarget.hostname.toLowerCase())
      ) {
        sendJson(res, 403, {
          error: `Target host "${parsedTarget.hostname}" is not in the configured provider allowlist.`,
        });
        return;
      }

      const resolvedHeaders: Record<string, string> = {};
      if (payload.headers && typeof payload.headers === 'object') {
        for (const [hk, hv] of Object.entries(payload.headers)) {
          if (typeof hv === 'string') {
            resolvedHeaders[hk] = replacePlaceholders(hv, realKeys);
          }
        }
      }

      let resolvedBody: string | Buffer | undefined;
      if (typeof payload.body === 'string') {
        if (payload.isBase64Body) {
          resolvedBody = Buffer.from(payload.body, 'base64');
        } else {
          resolvedBody = replacePlaceholders(payload.body, realKeys);
        }
      }

      // Route Gemini generateContent calls through the official @google/genai SDK
      const geminiMatch = parsedTarget.pathname.match(
        /\/models\/([^/:]+):generateContent$/i,
      );
      if (
        parsedTarget.hostname.toLowerCase() ===
          'generativelanguage.googleapis.com' &&
        geminiMatch &&
        typeof resolvedBody === 'string'
      ) {
        try {
          const modelName = decodeURIComponent(geminiMatch[1]);
          const apiKey =
            realKeys['gemini_api_key'] ||
            process.env['GEMINI_API_KEY'] ||
            process.env['API_KEY'] ||
            parsedTarget.searchParams.get('key') ||
            resolvedHeaders['x-goog-api-key'] ||
            '';
          const parsedJson = JSON.parse(resolvedBody) as {
            contents?: unknown;
            config?: Record<string, unknown>;
            generationConfig?: Record<string, unknown>;
            systemInstruction?: unknown;
          };

          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });

          if (Array.isArray(parsedJson.contents)) {
            for (const contentItem of parsedJson.contents as Array<{
              parts?: Array<Record<string, unknown>>;
            }>) {
              if (!Array.isArray(contentItem?.parts)) continue;
              for (let pIdx = 0; pIdx < contentItem.parts.length; pIdx++) {
                const part = contentItem.parts[pIdx];
                const fileData = part?.['fileData'] as
                  | { fileUri?: string; mimeType?: string }
                  | undefined;
                if (
                  fileData?.fileUri &&
                  fileData.fileUri.startsWith('local-upload://')
                ) {
                  const uploadId = fileData.fileUri.slice(
                    'local-upload://'.length,
                  );
                  const entry = uploadedVideos.get(uploadId);
                  if (!entry || !entry.buffer) {
                    sendJson(res, 410, {
                      error: {
                        code: 410,
                        status: 'UPLOAD_EXPIRED',
                        message:
                          'Local video upload session expired on server. Please retry.',
                      },
                    });
                    return;
                  }
                  entry.createdAt = Date.now();
                  const resolvedMime =
                    fileData.mimeType || entry.mimeType || 'video/mp4';
                  if (
                    entry.buffer.length <= MAX_INLINE_VIDEO_BYTES &&
                    !entry.geminiFileUri
                  ) {
                    contentItem.parts[pIdx] = {
                      inlineData: {
                        data: entry.buffer.toString('base64'),
                        mimeType: resolvedMime,
                      },
                    };
                  } else {
                    const uploadedFile = await resolveGeminiFileUri(
                      ai,
                      entry,
                      uploadId,
                    );
                    contentItem.parts[pIdx] = {
                      fileData: {
                        fileUri: uploadedFile.fileUri,
                        mimeType: uploadedFile.mimeType,
                      },
                    };
                  }
                }
              }
            }
          }

          const config: Record<string, unknown> = {
            ...(parsedJson.generationConfig || {}),
            ...(parsedJson.config || {}),
          };
          if (parsedJson.systemInstruction && !config['systemInstruction']) {
            config['systemInstruction'] = parsedJson.systemInstruction;
          }

          const sdkResponse = await ai.models.generateContent({
            model: modelName,
            contents: parsedJson.contents as never,
            config: Object.keys(config).length > 0 ? (config as never) : undefined,
          });

          sendJson(res, 200, sdkResponse);
          return;
        } catch (err: unknown) {
          const rawStatus = (err as { status?: number })?.status;
          const rawMsg =
            err instanceof Error ? err.message : 'Gemini SDK request failed';
          try {
            const parsed = JSON.parse(rawMsg) as {
              error?: { code?: number; status?: string; message?: string };
            };
            if (parsed && typeof parsed === 'object' && parsed.error) {
              const code =
                typeof rawStatus === 'number' && rawStatus >= 400
                  ? rawStatus
                  : typeof parsed.error.code === 'number' &&
                      parsed.error.code >= 400
                    ? parsed.error.code
                    : 502;
              sendJson(res, code, { error: parsed.error });
              return;
            }
          } catch {
            // Not a JSON error body from @google/genai SDK
          }
          const status =
            typeof rawStatus === 'number' && rawStatus >= 400 ? rawStatus : 502;
          sendJson(res, status, { error: { message: rawMsg, code: status } });
          return;
        }
      }

      try {
        const upstreamRes = await fetch(resolvedUrl, {
          method: payload.method || 'GET',
          headers: resolvedHeaders,
          body:
            payload.method &&
            payload.method.toUpperCase() !== 'GET' &&
            payload.method.toUpperCase() !== 'HEAD'
              ? (resolvedBody as BodyInit | undefined)
              : undefined,
        });

        if (!upstreamRes.ok) {
          const contentType = (
            upstreamRes.headers.get('content-type') || ''
          ).toLowerCase();
          if (contentType.includes('text/html')) {
            sendJson(res, upstreamRes.status, {
              error: {
                code: upstreamRes.status,
                status: upstreamRes.statusText || 'UPSTREAM_ERROR',
                message: `Upstream service ${parsedTarget.hostname} returned HTTP ${upstreamRes.status}${upstreamRes.statusText ? ` (${upstreamRes.statusText})` : ''}.`,
              },
            });
            return;
          }
        }

        res.statusCode = upstreamRes.status;
        const contentType = upstreamRes.headers.get('content-type');
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        const arrayBuf = await upstreamRes.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
        return;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Upstream proxy request failed';
        sendJson(res, 502, { error: { code: 502, message } });
        return;
      }
    }

    next();
  };
}
