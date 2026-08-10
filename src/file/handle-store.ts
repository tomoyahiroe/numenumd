/**
 * 「どのファイルをどこへ保存したか」の記憶。
 *
 * numenumd が持つ**唯一の永続状態**(spec「保存先の記憶」節)。編集内容そのものは
 * 一切保存しない。ここに入るのは `FileSystemFileHandle` と最終保存時刻だけで、
 * これはリロードのたびに保存先を選び直す体験を避けるためだけに存在する。
 */
export type RememberedTarget = {
  handle: FileSystemFileHandle;
  /** 最後に書き込んだ直後のファイル更新日時。外部変更の検知に使う。 */
  lastSavedMtime: number | null;
};

export interface HandleStore {
  get(path: string): Promise<RememberedTarget | null>;
  put(path: string, target: RememberedTarget): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

const DB_NAME = 'numenumd';
const STORE_NAME = 'saveTargets';

/**
 * IndexedDB を開くのを諦めるまでの時間(ms)。
 *
 * 記憶は保存フローの途中で引くため、`indexedDB.open` が何のコールバックも
 * 返さない状況(プライベートウィンドウやストレージ枯渇で実際に起きうる)に
 * なると `Cmd+S` がそのまま固まってしまう。記憶できないことは機能低下で
 * あって障害ではない(従来どおりピッカーが出るだけ)ので、待たずに諦める。
 */
const OPEN_TIMEOUT_MS = 2000;

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    // 諦めたあともタイマーを残さない(テストのプロセスが無駄に生き続ける)。
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      finish(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

function runRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    let request: IDBRequest<T>;
    try {
      request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    } catch {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/**
 * 記憶を持たないストア。IndexedDB が使えない環境ではこれに差し替わり、
 * 呼び出し側は「記憶が無かった」のと同じ経路(= ピッカーを出す)を通る。
 */
export const NULL_HANDLE_STORE: HandleStore = {
  get: async () => null,
  put: async () => {},
  count: async () => 0,
  clear: async () => {},
};

export function createHandleStore(): HandleStore {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const db = () => (dbPromise ??= openDatabase());

  return {
    async get(path) {
      const database = await db();
      if (!database) return null;
      const value = await runRequest<RememberedTarget | undefined>(
        database,
        'readonly',
        (store) => store.get(path),
      );
      return value ?? null;
    },

    async put(path, target) {
      const database = await db();
      if (!database) return;
      await runRequest(database, 'readwrite', (store) =>
        store.put(target, path),
      );
    },

    async count() {
      const database = await db();
      if (!database) return 0;
      return (
        (await runRequest<number>(database, 'readonly', (store) =>
          store.count(),
        )) ?? 0
      );
    },

    async clear() {
      const database = await db();
      if (!database) return;
      await runRequest(database, 'readwrite', (store) => store.clear());
    },
  };
}
