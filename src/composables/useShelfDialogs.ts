import { shallowRef } from 'vue';

const pendingShelfDialog = shallowRef(null);
let resolvePending: ((value: any) => void) | null = null;
let queue = Promise.resolve();

export function useShelfDialogs() {
  function askShelfDialog(options: any): Promise<any> {
    const task = queue.then(() => new Promise<any>(resolve => {
      resolvePending = resolve;
      pendingShelfDialog.value = options;
    }));
    queue = task.catch(() => {});
    return task;
  }

  function resolveShelfDialog(value = null) {
    const resolve = resolvePending;
    pendingShelfDialog.value = null;
    resolvePending = null;
    if (resolve) resolve(value);
  }

  return { pendingShelfDialog, askShelfDialog, resolveShelfDialog };
}
