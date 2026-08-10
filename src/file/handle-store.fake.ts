import type { HandleStore, RememberedTarget } from './handle-store';

/**
 * テスト用のインメモリ `HandleStore`。
 *
 * jsdom には IndexedDB が無いため、`createHandleStore()` はテスト環境では
 * 常にフォールバック(記憶しないストア)になる。記憶がある場合の挙動を
 * 検証するにはダブルが要るので、`handle-store.test.ts` と
 * `controller.test.ts` の双方から使えるようここに置く。
 *
 * アプリ側のコードからは参照されないので、バンドルには入らない。
 */
export function createFakeHandleStore(
  initial: Record<string, RememberedTarget> = {},
): HandleStore & { entries: Map<string, RememberedTarget> } {
  const entries = new Map<string, RememberedTarget>(Object.entries(initial));
  return {
    entries,
    get: async (path) => entries.get(path) ?? null,
    put: async (path, target) => {
      entries.set(path, target);
    },
    count: async () => entries.size,
    clear: async () => {
      entries.clear();
    },
  };
}
