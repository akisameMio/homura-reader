/* ============================================================================
   HOMURA · 同名导入确认
   ----------------------------------------------------------------------------
   文件选择与拖拽入口共用一个确认状态；导入队列确保同一时间只处理一组同名书。
   批量导入会先按文件名预检，同名文件可以一次决定保留或跳过。
   ========================================================================== */

import { shallowRef } from 'vue';

interface DuplicateItem { title?: string; existingTitle?: string; count?: number }
export interface DuplicatePending {
  batch: boolean;
  count: number;
  items: DuplicateItem[];
  title?: string;
  existingTitle?: string;
  busy: boolean;
  sessionId: number;
}
interface DuplicateSession {
  id: number;
  skipAll: boolean;
  closed: boolean;
  confirmDuplicates: (items: DuplicateItem[]) => Promise<boolean>;
  confirmDuplicate: (book: DuplicateItem, existingBook: DuplicateItem) => Promise<boolean>;
  hide: () => void;
  close: () => void;
}

const pendingDuplicate = shallowRef<DuplicatePending | null>(null);
let resolveDuplicate: ((value: boolean) => void) | null = null;
let activeSession: DuplicateSession | null = null;
let sessionSerial = 0;

export const DUPLICATE_SKIP_ALL = 'skip-all';

function normalizeDuplicateItems(items: DuplicateItem[] | null | undefined) {
  return (items || []).filter((item: DuplicateItem) => item && item.title);
}

function batchPending(items: DuplicateItem[], sessionId = 0) {
  const list = normalizeDuplicateItems(items);
  const count = list.reduce((total: number, item: DuplicateItem) => total + (item.count || 1), 0);
  return {
    batch: list.length > 1 || count > 1,
    count,
    items: list,
    title: list[0].title,
    existingTitle: list[0].existingTitle,
    busy: false,
    sessionId
  };
}

function presentDuplicate(pending: DuplicatePending) {
  pendingDuplicate.value = pending;
  return new Promise<boolean>((resolve) => {
    resolveDuplicate = resolve;
  });
}

export function useDuplicateImport() {
  function confirmDuplicates(items: DuplicateItem[]) {
    const list = normalizeDuplicateItems(items);
    if (list.length === 0) return Promise.resolve(true);
    return presentDuplicate(batchPending(list));
  }

  function confirmDuplicate(book: DuplicateItem, existingBook: DuplicateItem) {
    return confirmDuplicates([{ title: book.title, existingTitle: existingBook.title }]);
  }

  // 一个导入任务里的同名确认共享 skipAll；同一本书跳过后，下一本直接替换
  // 卡片内容而不是先清空 pending，避免卡片反复收缩再展开。
  function createDuplicateSession() {
    const sessionId = ++sessionSerial;
    const session: DuplicateSession = {
      id: sessionId,
      skipAll: false,
      closed: false,
      confirmDuplicates(items: DuplicateItem[]) {
        const list = normalizeDuplicateItems(items);
        if (list.length === 0) return Promise.resolve(true);
        if (session.closed || session.skipAll) return Promise.resolve(false);
        return presentDuplicate(batchPending(list, sessionId));
      },
      confirmDuplicate(book: DuplicateItem, existingBook: DuplicateItem) {
        return session.confirmDuplicates([{ title: book.title, existingTitle: existingBook.title }]);
      },
      hide() {
        if (!resolveDuplicate && pendingDuplicate.value?.sessionId === sessionId) {
          pendingDuplicate.value = null;
        }
      },
      close() {
        if (session.closed) return;
        session.closed = true;
        session.skipAll = false;
        if (activeSession === session) activeSession = null;
        if (pendingDuplicate.value?.sessionId === sessionId) {
          pendingDuplicate.value = null;
        }
        resolveDuplicate = null;
      }
    };
    activeSession = session;
    return session;
  }

  function resolveImport(result: boolean | string = false) {
    const resolve = resolveDuplicate;
    if (!resolve) return;
    const pending = pendingDuplicate.value;
    const keep = result === true;
    const skipAll = result === DUPLICATE_SKIP_ALL;
    resolveDuplicate = null;
    if (skipAll && activeSession) activeSession.skipAll = true;
    if (activeSession && pending?.sessionId === activeSession.id && !pending.batch && !skipAll) {
      pendingDuplicate.value = { ...pending, busy: true };
    } else {
      pendingDuplicate.value = null;
    }
    resolve(keep);
  }

  return { pendingDuplicate, confirmDuplicate, confirmDuplicates, createDuplicateSession, resolveImport };
}
