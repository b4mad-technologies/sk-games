import type { AgentMessage } from "@earendil-works/pi-agent-core";

const DB_NAME = "spellkave-chat";
const STORE_NAME = "transcripts";
const DB_VERSION = 1;

export type TranscriptStorage = {
	load(key: string): Promise<AgentMessage[] | null>;
	save(key: string, messages: AgentMessage[]): Promise<void>;
	clear(key: string): Promise<void>;
};

export function transcriptKey(userSub: string, modelId: string): string {
	return `${userSub}::${modelId}`;
}

export function createMemoryStorage(
	initial: Iterable<[string, AgentMessage[]]> = [],
): TranscriptStorage {
	const store = new Map<string, AgentMessage[]>(initial);
	return {
		async load(key) {
			return store.get(key) ?? null;
		},
		async save(key, messages) {
			store.set(key, messages);
		},
		async clear(key) {
			store.delete(key);
		},
	};
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
	});
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
	});
}

export function createIndexedDbStorage(): TranscriptStorage {
	return {
		async load(key) {
			const db = await openDb();
			try {
				const stored = await requestToPromise(
					db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
				);
				return Array.isArray(stored) ? (stored as AgentMessage[]) : null;
			} finally {
				db.close();
			}
		},
		async save(key, messages) {
			const db = await openDb();
			try {
				await requestToPromise(
					db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(messages, key),
				);
			} finally {
				db.close();
			}
		},
		async clear(key) {
			const db = await openDb();
			try {
				await requestToPromise(
					db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key),
				);
			} finally {
				db.close();
			}
		},
	};
}

export function defaultTranscriptStorage(): TranscriptStorage {
	if (typeof indexedDB === "undefined") return createMemoryStorage();
	return createIndexedDbStorage();
}
