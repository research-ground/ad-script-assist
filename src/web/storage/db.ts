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

import {
  AdScriptUpdateInitiator,
  AdSegment,
  ConversationEntry,
  HotkeyConfigEntry,
} from '../../core/types';
import {getDefaultHotkeyConfigs} from '../hotkeys';

export type StoredAdSegment = Omit<AdSegment, 'audioData'> & {
  id?: string;
  videoId: string;
};

export class SimpleDB {
  private getSafeStorage(): Storage | null {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      return localStorage;
    }
    return null;
  }

  private read<T>(table: string): T[] {
    try {
      const storage = this.getSafeStorage();
      if (!storage) return [];
      return JSON.parse(storage.getItem(`db_${table}`) || '[]');
    } catch { return []; }
  }
  private write<T>(table: string, data: T[]) {
    const storage = this.getSafeStorage();
    if (storage) {
      storage.setItem(`db_${table}`, JSON.stringify(data));
    }
  }

  async getAll<T>(table: string): Promise<T[]> {
    return this.read<T>(table);
  }
  
  async getByVideoId<T extends {videoId: string}>(table: string, videoId: string): Promise<T[]> {
    return this.read<T>(table).filter(i => i.videoId === videoId);
  }

  async add<T extends {id?: string}>(table: string, item: T): Promise<string> {
    const items = this.read<T>(table);
    const id = item.id || crypto.randomUUID();
    items.push({...item, id});
    this.write(table, items);
    return id;
  }

  async bulkAdd<T extends {id?: string}>(table: string, newItems: T[]) {
    const items = this.read<T>(table);
    for (const item of newItems) {
      items.push({...item, id: item.id || crypto.randomUUID()});
    }
    this.write(table, items);
  }
  
  async deleteByVideoId(table: string, videoId: string) {
    const items = this.read<{videoId?: string}>(table);
    this.write(table, items.filter(i => i.videoId !== videoId));
  }

  async modifyByVideoId<T extends {videoId: string}>(table: string, videoId: string, changes: Partial<T>) {
    const items = this.read<T>(table);
    const updated = items.map(i => i.videoId === videoId ? {...i, ...changes} : i);
    this.write(table, updated);
  }

  async modifyById<T extends {id?: string}>(table: string, id: string, changes: Partial<T>) {
    const items = this.read<T>(table);
    const updated = items.map(i => i.id === id ? {...i, ...changes} : i);
    this.write(table, updated);
  }
  
  async clear(table: string) {
    const storage = this.getSafeStorage();
    if (storage) {
      storage.removeItem(`db_${table}`);
    }
  }
}

export const db = new SimpleDB();

export async function storeAdSegmentsToDB(videoId: string, segments: AdSegment[], dbInstance: SimpleDB = db) {
  await dbInstance.deleteByVideoId('adSegments', videoId);
  await dbInstance.bulkAdd('adSegments', segments.map(s => {
    const {audioData, ...rest} = s;
    return {...rest, videoId, id: crypto.randomUUID()} as StoredAdSegment;
  }));
}

export async function retrieveAdSegmentsForVideoFromDB(videoId: string, dbInstance: SimpleDB = db): Promise<AdSegment[]> {
  const segments = await dbInstance.getByVideoId<StoredAdSegment>('adSegments', videoId);
  return segments.map(s => {
    const {id, ...rest} = s;
    return rest as AdSegment;
  }).sort((a, b) => a.startTime - b.startTime);
}


export async function addConversationEntryToDB(entry: ConversationEntry, dbInstance: SimpleDB = db) {
  await dbInstance.add('conversationHistory', {...entry, id: crypto.randomUUID()});
}

export async function trashAllConversationHistoryForVideo(videoId: string, dbInstance: SimpleDB = db) {
  await dbInstance.modifyByVideoId<ConversationEntry>('conversationHistory', videoId, {trashed: true});
}

export async function retrieveConversationHistoryForVideoFromDB(videoId: string, dbInstance: SimpleDB = db): Promise<ConversationEntry[]> {
  const history = await dbInstance.getByVideoId<ConversationEntry & {id?: string}>('conversationHistory', videoId);
  return history.map(h => { const {id, ...rest} = h; return rest; }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function retrieveAllConversationHistoryFromDB(dbInstance: SimpleDB = db): Promise<ConversationEntry[]> {
  const history = await dbInstance.getAll<ConversationEntry & {id?: string}>('conversationHistory');
  return history.map(h => { const {id, ...rest} = h; return rest; }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function storeLatestAdScriptToDB(videoId: string, script: string, dbInstance: SimpleDB = db) {
  // Overwrite existing script for this video
  const items = await dbInstance.getByVideoId<{videoId: string, script: string}>('adScript', videoId);
  if (items.length > 0) {
    await dbInstance.modifyByVideoId<{videoId: string, script: string}>('adScript', videoId, {script});
  } else {
    await dbInstance.add<{videoId: string, script: string, id?: string}>('adScript', {videoId, script});
  }
}

export async function retrieveLatestAdScriptForVideoFromDB(videoId: string, dbInstance: SimpleDB = db): Promise<{script: string} | null> {
  const history = await dbInstance.getByVideoId<{videoId: string, script: string}>('adScript', videoId);
  if (history.length === 0) return null;
  return history[0];
}


export async function retrieveHotkeyConfigsFromDB(dbInstance: SimpleDB = db): Promise<HotkeyConfigEntry[]> {
  const dbConfigs = await dbInstance.getAll<HotkeyConfigEntry>('hotkeyConfigs');
  if (dbConfigs.length === 0) return getDefaultHotkeyConfigs().map(def => ({...def}));
  const configMap = new Map(dbConfigs.map(c => [c.command, c]));
  return getDefaultHotkeyConfigs().map(def => {
    const override = configMap.get(def.command);
    return override ? {...def, ...override} : {...def};
  });
}

export async function storeHotkeyConfigsToDB(newConfigs: HotkeyConfigEntry[], dbInstance: SimpleDB = db) {
  const configs = await dbInstance.getAll<HotkeyConfigEntry>('hotkeyConfigs');
  for (const config of newConfigs) {
    const index = configs.findIndex(c => c.command === config.command);
    if (index >= 0) configs[index] = config;
    else configs.push(config);
  }
  localStorage.setItem('db_hotkeyConfigs', JSON.stringify(configs));
}

export async function storeHotkeyConfigToDB(config: HotkeyConfigEntry, dbInstance: SimpleDB = db) {
  await storeHotkeyConfigsToDB([config], dbInstance);
}

export async function resetHotkeyConfigsInDB(dbInstance: SimpleDB = db) {
  await dbInstance.clear('hotkeyConfigs');
}

export async function clearAllDataForVideo(videoId: string, dbInstance: SimpleDB = db) {
  await Promise.all([
    dbInstance.deleteByVideoId('adSegments', videoId),
    dbInstance.deleteByVideoId('geminiLogs', videoId),
    dbInstance.deleteByVideoId('conversationHistory', videoId),
    dbInstance.deleteByVideoId('adScript', videoId),
    dbInstance.deleteByVideoId('hotkeyActivations', videoId),
  ]);
}
