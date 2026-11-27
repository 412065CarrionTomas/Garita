import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import {
  computeSyncedUntil,
  checkpointRecordResponseSchema,
  checkpointRecordRequestSchema,
  CONNECTION_NOTICE_INTERVAL_SECONDS,
  SYNC_BATCH_MAX_EVENTS,
  syncEventId,
  type ConnectionNoticeRequest,
  type ConnectionNoticeResponse,
  type SyncBatchRequest,
  type SyncBatchResponse,
} from '@garita/shared';
import {
  createDefaultFieldRepository,
  applyCheckpointRecordResponse,
  type FieldRepository,
  type LocalPanicAlert,
} from '@/lib/db/database';
import { prepareEventClocks, saveTimeReference } from '@/lib/clock/clock';
import { sendConnectionNotice, sendSyncBatch } from './api';
import { computeSyncBackoff } from './backoff';
import { deleteShiftCredential, getShiftCredentialToken } from './credential';
import { processIncidentPhotos } from '@/lib/fotos/photo-queue';
import { dispatchPanicAlert } from '@/features/panico/transport';
import { blockPanicAfterClose, isPanicAfterLocalClose } from '@/features/panico/running-shift';

export interface SyncStateSnapshot {
  isSyncing: boolean;
  isOffline: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
}

export interface SyncServiceDependencies {
  now(): Date;
  online(): Promise<boolean>;
  appState(): AppStateStatus;
  repository(): Promise<FieldRepository>;
  sendBatch(request: SyncBatchRequest, token?: string | null): Promise<SyncBatchResponse>;
  sendNotice(
    request: ConnectionNoticeRequest,
    token?: string | null,
  ): Promise<ConnectionNoticeResponse>;
  getCredentialToken(): Promise<string | null>;
  deleteCredential(): Promise<void>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const defaultDependencies: SyncServiceDependencies = {
  now: () => new Date(),
  online: async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      return state.isConnected === true && state.isInternetReachable !== false;
    } catch {
      return false;
    }
  },
  appState: () => AppState.currentState,
  repository: createDefaultFieldRepository,
  sendBatch: sendSyncBatch,
  sendNotice: sendConnectionNotice,
  getCredentialToken: getShiftCredentialToken,
  deleteCredential: deleteShiftCredential,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

let overrides: Partial<SyncServiceDependencies> = {};

export function setSyncServiceForTesting(next: Partial<SyncServiceDependencies>): void {
  overrides = next;
}

export function resetSyncServiceForTesting(): void {
  overrides = {};
  isSyncing = false;
  isOffline = false;
  consecutiveFailures = 0;
  retryTimerId = null;
  noticeTimerId = null;
  listeners.clear();
}

function deps(): SyncServiceDependencies {
  return { ...defaultDependencies, ...overrides };
}

// In-memory state
let isSyncing = false;
let isOffline = false;
let consecutiveFailures = 0;
let retryTimerId: unknown = null;
let noticeTimerId: unknown = null;
let networkSubscribed = false;
let appStateSubscribed = false;
const listeners = new Set<() => void>();

export function notifySyncState(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeSyncState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function getSyncSnapshot(): Promise<SyncStateSnapshot> {
  const d = deps();
  try {
    const repo = await d.repository();
    const pendingCount = repo.countPendingEvents
      ? await repo.countPendingEvents()
      : ((await repo.listPendingEvents?.())?.length ?? 0);
    const lastSyncAt = repo.getSyncMeta ? await repo.getSyncMeta('last_sync_at') : null;
    return {
      isSyncing,
      isOffline,
      pendingCount,
      lastSyncAt,
    };
  } catch {
    return {
      isSyncing,
      isOffline,
      pendingCount: 0,
      lastSyncAt: null,
    };
  }
}

/**
 * Extensibility point for HU-21 (panic alert):
 * Urgent events bypass normal queue waiting and are sent immediately.
 */
export async function sendUrgentEvent(event: LocalPanicAlert): Promise<void> {
  await dispatchPanicAlert(event);
}

/**
 * Primary sync function: drains the pending queue in batches of up to SYNC_BATCH_MAX_EVENTS (100).
 * Handles network failures with exponential backoff (no attempt limit, CA11),
 * updates local checkpoint_records, ignores rejected events for subsequent batches (recording reason),
 * and cleans up shift data/credentials when shift_close completes and queue is empty.
 */
export async function processSyncQueue(): Promise<{
  processed: number;
  batchesSent: number;
  success: boolean;
}> {
  if (isSyncing) {
    return { processed: 0, batchesSent: 0, success: false };
  }

  const d = deps();
  const online = await d.online();
  if (!online) {
    isOffline = true;
    notifySyncState();
    return { processed: 0, batchesSent: 0, success: false };
  }

  isOffline = false;
  isSyncing = true;
  notifySyncState();

  let totalProcessed = 0;
  let batchesSent = 0;
  let overallSuccess = true;

  try {
    const repo = await d.repository();

    while (true) {
      const pendingPanics = (await repo.listPanicAlerts()).filter(
        (alert) => !alert.state && !alert.blockedReason,
      );
      for (const alert of pendingPanics) {
        if (await isPanicAfterLocalClose(repo, alert)) await blockPanicAfterClose(repo, alert);
        else await sendUrgentEvent(alert);
      }
      if ((await repo.listPanicAlerts()).some((alert) => !alert.state && !alert.blockedReason)) {
        scheduleRetry(computeSyncBackoff(consecutiveFailures++));
        overallSuccess = false;
        break;
      }
      // Re-verify network connection before each batch
      if (!(await d.online())) {
        isOffline = true;
        overallSuccess = false;
        break;
      }

      // Read pending events in order (occurredAtDevice / createdAt)
      const allPending = await repo.listPendingEvents({ limit: SYNC_BATCH_MAX_EVENTS });
      // Photo bytes use their own queue; incident metadata travels through batch sync.
      const syncableEvents = allPending.filter(
        (e) => e.type === 'checkpoint_record' || e.type === 'shift_close' || e.type === 'incident',
      );

      if (syncableEvents.length === 0) {
        // Check if there was a closed shift whose queue is now completely empty
        const shiftData = await repo.getShiftData();
        const pendingCount = await repo.countPendingEvents();
        if (shiftData && pendingCount === 0) {
          // If all events are sent, check if shift was closed locally
          // (i.e. shift_close was sent or shift marked closed)
          const allEvents = await repo.listPendingEvents({ limit: 1 });
          if (allEvents.length === 0) {
            // Check if shift close was sent in the past
            // If shift_close was processed, we clear shift data and credentials
            const wasShiftClosed = await repo.getSyncMeta('shift_closed_done');
            if (wasShiftClosed === 'true' && (await repo.listIncidentPhotos()).length === 0) {
              await repo.clearShiftData();
              await d.deleteCredential();
              await repo.setSyncMeta('shift_closed_done', 'false');
            }
          }
        }
        break;
      }

      // Take batch of at most SYNC_BATCH_MAX_EVENTS (100)
      let batchSlice;
      try {
        batchSlice = await prepareEventClocks(repo, syncableEvents.slice(0, SYNC_BATCH_MAX_EVENTS));
      } catch {
        scheduleRetry(computeSyncBackoff(consecutiveFailures++));
        overallSuccess = false;
        break;
      }
      if (batchSlice.length === 0) {
        scheduleRetry(computeSyncBackoff(consecutiveFailures++));
        overallSuccess = false;
        break;
      }
      const totalPending = await repo.countPendingEvents();
      const remainingCount = Math.max(0, totalPending - batchSlice.length);

      // Extract shiftId from current shift or payload
      const shiftData = await repo.getShiftData();
      let shiftId = shiftData?.shift.id;
      const firstEvent = batchSlice[0];
      if (!shiftId && firstEvent) {
        const payload = firstEvent.payload as { shiftId?: string };
        shiftId = payload?.shiftId ?? '';
      }

      const previousSyncedUntil = await repo.getSyncMeta('synced_until');

      const batchRequest: SyncBatchRequest = {
        shiftId: shiftId ?? '',
        events: batchSlice.map((e) => ({
          type: e.type as 'checkpoint_record' | 'shift_close' | 'incident',
          payload: e.payload as never,
        })),
        pendingCount: remainingCount,
        syncedUntil: previousSyncedUntil,
      };

      const credentialToken = await d.getCredentialToken();
      let response: SyncBatchResponse;

      try {
        response = await d.sendBatch(batchRequest, credentialToken);
      } catch {
        // Network error, 5xx or server failure
        // Do not mark anything as sent; back off and retry later (CA11)
        const waitSeconds = computeSyncBackoff(consecutiveFailures);
        consecutiveFailures++;
        scheduleRetry(waitSeconds);
        overallSuccess = false;
        break;
      }

      // Success for this batch
      if (response.serverTime) await saveTimeReference(repo, response.serverTime);
      consecutiveFailures = 0;
      if (retryTimerId !== null) {
        d.clearTimeout(retryTimerId);
        retryTimerId = null;
      }

      batchesSent++;
      totalProcessed += batchSlice.length;

      const receivedEventIds = new Set<string>();
      // Una sola lectura por lote: releer la tabla por evento vuelve cuadrático el envío.
      const knownRecords = response.results.some((result) => result.status === 'accepted')
        ? await repo.listCheckpointRecords()
        : [];

      for (const result of response.results) {
        const matchingEvent = batchSlice.find(
          (e) => syncEventId(e as never) === result.eventId || e.id === result.eventId,
        );

        if (result.status === 'accepted') {
          receivedEventIds.add(result.eventId);
          if (matchingEvent?.type === 'shift_close') {
            await repo.setSyncMeta('shift_closed_done', 'true');
          }
          if (
            matchingEvent?.type === 'checkpoint_record' &&
            'outcome' in result &&
            result.outcome
          ) {
            await applyCheckpointRecordResponse(
              repo,
              checkpointRecordRequestSchema.parse(matchingEvent.payload),
              checkpointRecordResponseSchema.parse(result.outcome),
              knownRecords,
            );
          }
          await repo.markPendingEventSent(result.eventId);
        } else if (result.status === 'duplicate') {
          receivedEventIds.add(result.eventId);
          await repo.markPendingEventSent(result.eventId);
          if (matchingEvent?.type === 'shift_close') {
            await repo.setSyncMeta('shift_closed_done', 'true');
          }
          if (matchingEvent?.type === 'checkpoint_record')
            await repo.updateCheckpointRecordServerResult(result.eventId, 'recorded');
        } else if (result.status === 'rejected') {
          receivedEventIds.add(result.eventId);
          // Keep on phone for diagnosis, record reason, and continue with the rest
          await repo.markPendingEventRejected(result.eventId, result.reason);
          if (matchingEvent?.type === 'checkpoint_record')
            await repo.updateCheckpointRecordServerResult(
              result.eventId,
              'rejected',
              result.reason,
            );
        }
      }

      // Update syncedUntil (CA7)
      const receivedInOrder = batchSlice
        .filter((event) => receivedEventIds.has(syncEventId(event as never) ?? event.id))
        .map((event) => ({
          occurredAtDevice: event.occurredAtDevice,
          clock: batchRequest.events.find((item) => syncEventId(item) === event.id)?.payload.clock,
        }));
      const nextSyncedUntil = computeSyncedUntil(receivedInOrder, previousSyncedUntil);
      if (nextSyncedUntil) {
        await repo.setSyncMeta('synced_until', nextSyncedUntil);
      }

      // Update last successful sync timestamp
      await repo.setSyncMeta('last_sync_at', d.now().toISOString());

      // If a shift close was confirmed and queue is now empty, clear shift and credential
      const remainingTotal = await repo.countPendingEvents();
      const isShiftClosed = (await repo.getSyncMeta('shift_closed_done')) === 'true';
      if (isShiftClosed && remainingTotal === 0 && (await repo.listIncidentPhotos()).length === 0) {
        await repo.clearShiftData();
        await d.deleteCredential();
        await repo.setSyncMeta('shift_closed_done', 'false');
      }

      notifySyncState();

      // If no more events remain for the next batch, break out
      if (remainingCount === 0) {
        break;
      }
    }
  } finally {
    isSyncing = false;
    notifySyncState();
  }

  void processIncidentPhotos();

  return { processed: totalProcessed, batchesSent, success: overallSuccess };
}

export function scheduleSyncRetry(): void {
  notifySyncState();
  scheduleRetry(0);
}

function scheduleRetry(seconds: number): void {
  const d = deps();
  if (retryTimerId !== null) {
    d.clearTimeout(retryTimerId);
  }
  retryTimerId = d.setTimeout(() => {
    retryTimerId = null;
    void processSyncQueue();
  }, seconds * 1000);
}

/**
 * Sends a connection notice if a shift is in progress, device is online,
 * and app is in foreground (CA5). Failures are silently ignored.
 */
export async function sendConnectionNoticeIfNeeded(): Promise<boolean> {
  const d = deps();

  // App must be in foreground
  if (d.appState() !== 'active') {
    return false;
  }

  // Must be online
  if (!(await d.online())) {
    isOffline = true;
    notifySyncState();
    return false;
  }

  const repo = await d.repository();
  const shiftData = await repo.getShiftData();
  if (!shiftData) {
    // No shift in progress: do not send notice
    return false;
  }

  const pendingCount = await repo.countPendingEvents();
  const syncedUntil = await repo.getSyncMeta('synced_until');
  const credentialToken = await d.getCredentialToken();

  try {
    await d.sendNotice(
      {
        shiftId: shiftData.shift.id,
        sentAtDevice: d.now().toISOString(),
        pendingCount,
        syncedUntil,
      },
      credentialToken,
    );
    return true;
  } catch {
    // Silently ignore failures; will retry on next cycle (CA5)
    return false;
  }
}

/**
 * Starts background sync triggers:
 * 1. Network listener
 * 2. AppState listener
 * 3. Connection notice interval (every CONNECTION_NOTICE_INTERVAL_SECONDS)
 */
export function initSyncService(): () => void {
  const d = deps();

  if (!networkSubscribed) {
    networkSubscribed = true;
    Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        isOffline = false;
        notifySyncState();
        void processSyncQueue();
      } else {
        isOffline = true;
        notifySyncState();
      }
    });
  }

  if (!appStateSubscribed) {
    appStateSubscribed = true;
    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void processSyncQueue();
        void sendConnectionNoticeIfNeeded();
      }
    });
  }

  if (noticeTimerId === null) {
    noticeTimerId = d.setInterval(() => {
      void sendConnectionNoticeIfNeeded();
    }, CONNECTION_NOTICE_INTERVAL_SECONDS * 1000);
  }

  return () => {
    if (noticeTimerId !== null) {
      d.clearInterval(noticeTimerId);
      noticeTimerId = null;
    }
  };
}
