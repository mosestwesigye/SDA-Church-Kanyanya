"use client";

/**
 * Offline outbox: member edits saved on this device while offline, sent to
 * the server when the connection returns. Each item carries the record
 * version it was based on, so the server rejects it (conflict) if someone
 * else changed the member in the meantime — nothing is silently overwritten.
 */
export type OutboxItem = {
  id: string; // also the audit correlation id, so a retried sync is applied once
  kind: "member.update";
  memberId: string;
  label: string; // "SDAK/M0123 · Nakato, Grace" — shown in the pending list
  version: number;
  patch: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "conflict" | "failed";
  error?: string;
};

const DB = "sdak-outbox";
const STORE = "items";
const EVENT = "sdak-outbox-change";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => reject(t.error);
  });
}

const changed = () => window.dispatchEvent(new Event(EVENT));

export async function listOutbox(): Promise<OutboxItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const items = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function queueMemberUpdate(input: Pick<OutboxItem, "memberId" | "label" | "version" | "patch">): Promise<void> {
  const item: OutboxItem = { ...input, id: crypto.randomUUID(), kind: "member.update", createdAt: Date.now(), status: "pending" };
  await tx("readwrite", (s) => s.put(item));
  changed();
}

export async function removeOutboxItem(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  changed();
}

export async function clearOutbox(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await tx("readwrite", (s) => s.clear());
  changed();
}

export function onOutboxChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

let syncing: Promise<void> | null = null;

/** Send pending items one by one. Stops at the first network failure. */
export function syncOutbox(): Promise<void> {
  syncing ??= (async () => {
    try {
      for (const item of await listOutbox()) {
        if (item.status !== "pending") continue;
        let res: Response;
        try {
          res = await fetch("/api/sync/member-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: item.id, memberId: item.memberId, version: item.version, patch: item.patch }),
          });
        } catch {
          return; // still offline
        }
        if (res.ok) {
          await tx("readwrite", (s) => s.delete(item.id));
        } else if (res.status === 401) {
          return; // signed out: keep items until the user signs in again
        } else {
          const msg = await res.text().catch(() => "");
          const next: OutboxItem = { ...item, status: res.status === 409 ? "conflict" : "failed", error: msg.slice(0, 300) || `Error ${res.status}` };
          await tx("readwrite", (s) => s.put(next));
        }
        changed();
      }
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Sign-out hygiene: drop offline pages (personal data) and, after confirmation upstream, queued edits. */
export async function clearDeviceData(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
    if ("caches" in window) await caches.delete("sdak-pages");
  } catch {}
  try {
    await clearOutbox();
  } catch {}
}
