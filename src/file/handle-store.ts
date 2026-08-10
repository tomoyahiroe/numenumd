/**
 * 「どのファイルをどこへ保存したか」の記憶。
 *
 * **numenumd 自身が読み書きする唯一の永続データ**(spec「保存先の記憶」節)。
 * 編集内容そのものは一切保存しない。ここに入るのは `FileSystemFileHandle` と
 * 最終保存時刻だけで、リロードのたびに保存先を選び直す体験を避けるためだけに
 * 存在する。
 *
 * なお「numenumd に関係する永続状態がこれだけ」という意味ではない。
 * `showSaveFilePicker({ id })` を渡しているので Chrome は (origin, id) ごとに
 * 最後に使ったディレクトリを覚えるし(`./picker-id.ts`)、File System Access の
 * 許可も Chrome 側に永続化されうる。どちらも numenumd からは読めないが、
 * ブラウザには残る。
 */
export type RememberedTarget = {
  handle: FileSystemFileHandle;
  /** 最後に書き込んだ直後のファイル更新日時。外部変更の検知に使う。 */
  lastSavedMtime: number | null;
};

export interface HandleStore {
  /** 記憶が無い・引けない場合は `null`(呼び出し側はピッカーへ落ちる)。 */
  get(path: string): Promise<RememberedTarget | null>;
  /** best-effort。失敗しても投げない(保存自体は成功しているため)。 */
  put(path: string, target: RememberedTarget): Promise<void>;
  /** 引けない場合は 0。 */
  count(): Promise<number>;
  /** **失敗したら throw する。** ユーザーが結果を信じる唯一の操作なので。 */
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

/**
 * 失敗を `null` に潰して返す読み取り系のヘルパー。
 *
 * 記憶が引けないことは機能低下であって障害ではない(呼び出し側は「記憶が
 * 無かった」のと同じ経路 = ピッカーへ落ちる)ので、例外を投げずに `null` を
 * 返す。**書き込みの成否をユーザーに伝える必要がある `clear()` では使わない**
 * — `runWriteToCompletion` を参照。
 */
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
 * 書き込みを**コミットまで見届けて**、失敗したら reject する。
 *
 * `runRequest` は決して reject しないため、それで `clear()` を実装すると
 * 「消せていないのに『消しました』と表示する」ことになる。`PRIVACY.md` は
 * 「いつでも消せます…すべて削除します」と約束しているので、消去だけは結果を
 * 正直に返す必要がある(独立レビューでの指摘。当時 `App.tsx` の catch は
 * 到達不能な死んだコードだった)。
 *
 * `request.onsuccess` ではなく `transaction.oncomplete` を待つのは、リクエスト
 * 自体は成功してもコミット時に abort しうるため(クォータ超過など)。
 */
function runWriteToCompletion(
  db: IDBDatabase,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
      run(tx.objectStore(STORE_NAME));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function createHandleStore(): HandleStore {
  // 一度 open に失敗したら、そのタブが生きている間は再試行しない。記憶できない
  // ことは機能低下でしかなく(毎回ピッカーが出るだけ)、保存のたびに2秒の
  // タイムアウトを踏み直すほうが体験として悪いため、意図的にこうしている。
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

    // 唯一、失敗を呼び出し側へ伝えるメソッド。ユーザーが結果を信じる操作
    // (「消えた」と思って画面を閉じる)なので、黙って成功にしてはいけない。
    async clear() {
      const database = await db();
      if (!database) {
        throw new Error('IndexedDB is unavailable');
      }
      await runWriteToCompletion(database, (store) => store.clear());
    },
  };
}
