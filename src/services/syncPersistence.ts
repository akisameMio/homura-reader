/* ============================================================================
   HOMURA · 同步工作状态
   ----------------------------------------------------------------------------
   文档和本地比较基线一起提交；断网或进程退出后可从已落盘的书架重建待发送变更。
   密码不进入此数据库。不同服务器和账号使用独立工作状态。
   ========================================================================== */

import type { SyncEngineState } from './syncEngine.ts';

let database: Promise<IDBDatabase> | null = null;

function open() {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('homura_sync', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('同步状态保存失败'));
  }).catch(error => { database = null; throw error; });
  return database;
}

export async function loadSyncState(id: string): Promise<SyncEngineState | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('profiles', 'readonly');
    const request = tx.objectStore('profiles').get(id);
    tx.oncomplete = () => resolve(request.result || null);
    tx.onerror = tx.onabort = () => reject(new Error('同步状态读取失败'));
  });
}

export async function saveSyncState(next: SyncEngineState, previousRevision: number): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('profiles', 'readwrite');
    const store = tx.objectStore('profiles');
    const request = store.get(next.id);
    let changed = false;
    request.onsuccess = () => {
      if ((request.result?.revision || 0) !== previousRevision) {
        changed = true;
        tx.abort();
        return;
      }
      store.put(next);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error(changed ? 'SYNC_STATE_CHANGED' : '同步状态保存失败'));
  });
}
