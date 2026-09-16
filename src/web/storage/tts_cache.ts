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

export interface TtsItem {
  key: string;
  text: string;
  voice: string;
  speed: number;
  audio: Blob;
  timestamp: number;
}

export class TtsCache {
  private static readonly DB_NAME = 'ad-script-assist-tts-cache';
  private static readonly TABLE_NAME = 'tts-keys';
  private static readonly MAX_CACHE_SIZE = 50;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(TtsCache.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TtsCache.TABLE_NAME)) {
          db.createObjectStore(TtsCache.TABLE_NAME, {keyPath: 'key'});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async get(text: string, voice: string, speed: number): Promise<Blob | undefined> {
    if (typeof indexedDB === 'undefined') return undefined;
    const key = await TtsCache.generateKey(text, voice, speed);
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TtsCache.TABLE_NAME, 'readonly');
      const req = tx.objectStore(TtsCache.TABLE_NAME).get(key);
      req.onsuccess = () => {
        const item = req.result as TtsItem;
        resolve(item ? item.audio : undefined);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async add(text: string, voice: string, speed: number, audio: Blob): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const key = await TtsCache.generateKey(text, voice, speed);
    const item: TtsItem = { key, text, voice, speed, audio, timestamp: Date.now() };
    const db = await this.getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TtsCache.TABLE_NAME, 'readwrite');
      const req = tx.objectStore(TtsCache.TABLE_NAME).put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(tx.error);
    });
    await this.prune();
  }

  private async prune(): Promise<void> {
    const db = await this.getDB();
    const items = await new Promise<TtsItem[]>((resolve, reject) => {
      const tx = db.transaction(TtsCache.TABLE_NAME, 'readonly');
      const req = tx.objectStore(TtsCache.TABLE_NAME).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (items.length <= TtsCache.MAX_CACHE_SIZE) return;
    
    items.sort((a, b) => a.timestamp - b.timestamp);
    const deleteCount = items.length - TtsCache.MAX_CACHE_SIZE;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TtsCache.TABLE_NAME, 'readwrite');
      for (let i = 0; i < deleteCount; i++) {
        tx.objectStore(TtsCache.TABLE_NAME).delete(items[i].key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  static async generateKey(text: string, voice: string, speed: number): Promise<string> {
    const input = `${voice}:${speed}:${text}`;
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(input));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }
}

export const ttsCache = new TtsCache();
