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

// @ts-nocheck

/// <reference lib="webworker" />

const CACHE_NAME = 'ad-script-assist-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/public/manifest.json',
  '/public/favicon.png',
];

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    self.caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }),
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.method !== 'GET') return;

  // Navigation requests: NETWORK FIRST, fall back to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return self.caches.match('/index.html') as Promise<Response>;
      }),
    );
    return;
  }

  // Other requests: STALE-WHILE-REVALIDATE for cached assets, NETWORK ONLY for others
  event.respondWith(
    self.caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached response immediately, but also update cache in background
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              return self.caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // The background cache update failed. This is not critical,
            // as the user is still being served the cached content.
          });

        event.waitUntil(networkFetch);
        return cachedResponse;
      }
      return fetch(event.request);
    }),
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    self.caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return self.caches.delete(cacheName);
          }
          return Promise.resolve();
        }),
      );
    }),
  );
});
