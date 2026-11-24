import type { Book, BookSource } from '../types.ts';
import { buildManagedNovel, canStoreManagedNovel } from './managedBook.ts';
import { runShelfMutation } from './mutationQueue.ts';
import { HomuraStore } from './storage.ts';
import { fingerprintSource } from './syncIdentity.ts';
import {
  createSmartStorageRepository,
  evaluateSmartTransferEligibility,
  findReclaimableAutoArchives,
  rankSmartTransferCandidates,
  reconcileReadingSession,
  type ReadingSessionSnapshot,
  type SmartStorageRepository
} from './smartStorage.ts';
import { readSmartStorageConfig } from './smartStorageSettings.ts';

let repository: SmartStorageRepository | undefined;

function store() {
  return repository ??= createSmartStorageRepository();
}

export async function loadSmartArchive(id: string, source: BookSource) {
  if (!source.nativeReference || !source.contentFingerprint) return null;
  const record = await store().loadAutoArchive(id);
  return record?.archive.sourceFingerprint === source.contentFingerprint ? record.archive : null;
}

async function maintainArchives(book?: Book, activitySnapshot?: ReadingSessionSnapshot) {
  const config = readSmartStorageConfig();
  if (!config.enabled) return;
  const db = store();
  const source = book ? await HomuraStore.getSource(book.id) as BookSource | null : null;
  const current = source?.nativeReference && book && canStoreManagedNovel(book) ? book : null;
  if (current && activitySnapshot) await db.recordActivity(reconcileReadingSession(activitySnapshot));
  const [activities, archives] = await Promise.all([db.listActivities(), db.listAutoArchiveSummaries()]);
  const budget = config.budgetMb * 1024 * 1024;
  const idle = new Set(findReclaimableAutoArchives(activities, archives));
  const activityById = new Map(activities.map(item => [item.bookId, item]));
  const active = current && activityById.get(current.id);
  const candidate = current && active && !archives.some(archive => archive.bookId === current.id)
    && evaluateSmartTransferEligibility({ activity: active, sourceAvailable: true, archiveBytes: 1 }).eligible
    ? await buildManagedNovel(current, source?.contentFingerprint)
    : null;
  const existing = archives.flatMap(archive => {
    const activity = activityById.get(archive.bookId);
    if (!activity || idle.has(archive.bookId)) return [];
    const evaluation = evaluateSmartTransferEligibility({ activity, sourceAvailable: true, archiveBytes: archive.bytes });
    return [{ ...evaluation, eligible: true }];
  });
  if (candidate && active) existing.push(evaluateSmartTransferEligibility({
    activity: active,
    sourceAvailable: true,
    archiveBytes: candidate.bytes
  }));
  const ranked = rankSmartTransferCandidates(existing, budget);
  const keep = new Set(ranked.selected.map(item => item.bookId));
  let used = archives.reduce((bytes, archive) => bytes + archive.bytes, 0);
  const reclaim = [...archives].sort((left, right) => {
    const priority = Number(idle.has(right.bookId)) - Number(idle.has(left.bookId));
    return priority || ranked.ranked.findIndex(item => item.bookId === right.bookId)
      - ranked.ranked.findIndex(item => item.bookId === left.bookId);
  });
  const shouldSave = !!(candidate && current && keep.has(current.id));
  for (const archive of reclaim) {
    if (keep.has(archive.bookId) || (!idle.has(archive.bookId) && used + (shouldSave ? candidate.bytes : 0) <= budget)) continue;
    const original = await HomuraStore.getSource(archive.bookId) as BookSource | null;
    if (original) {
      if (!original.nativeReference || !original.contentFingerprint) continue;
      try {
        if (await fingerprintSource(original) !== original.contentFingerprint) continue;
      } catch {
        continue;
      }
    }
    await db.deleteAutoArchive(archive.bookId);
    used -= archive.bytes;
  }
  if (shouldSave && used + candidate.bytes <= budget) {
    await db.saveAutoArchive(current.id, candidate);
  }
}

export function scheduleSmartStorage(book?: Book, activity?: ReadingSessionSnapshot) {
  if (!readSmartStorageConfig().enabled) return;
  void runShelfMutation(() => maintainArchives(book, activity)).catch(error => {
    console.warn('[HOMURA] 智能转存失败', error);
  });
}

export async function forgetSmartArchive(id: string) {
  await store().deleteAutoArchive(id);
}

export async function forgetSmartReading(id?: string) {
  if (id) await store().deleteBookLearning(id);
  else await store().clear();
}
