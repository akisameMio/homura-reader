import { shallowRef } from 'vue';

export interface ShelfDialogOptions {
  kind: string;
  title: string;
  message?: string;
  intent?: 'create' | 'rename' | 'delete' | 'favorite';
  removesFiles?: boolean;
  bookCount?: number;
  collectionCount?: number;
  groupByFolder?: boolean;
  initialName?: string;
  options?: Array<{ value: string; title?: string }>;
  confirmLabel?: string;
  validate?: (name: string) => string | null;
}
type ShelfDialogResult = string | boolean | null;

const pendingShelfDialog = shallowRef<ShelfDialogOptions | null>(null);
let resolvePending: ((value: ShelfDialogResult) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function useShelfDialogs() {
  function askShelfDialog(options: ShelfDialogOptions): Promise<ShelfDialogResult> {
    const task = queue.then(() => new Promise<ShelfDialogResult>(resolve => {
      resolvePending = resolve;
      pendingShelfDialog.value = options;
    }));
    queue = task.catch(() => {});
    return task;
  }

  function resolveShelfDialog(value: ShelfDialogResult = null) {
    const resolve = resolvePending;
    pendingShelfDialog.value = null;
    resolvePending = null;
    if (resolve) resolve(value);
  }

  return { pendingShelfDialog, askShelfDialog, resolveShelfDialog };
}
