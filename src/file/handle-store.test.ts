// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { createHandleStore } from './handle-store';
import { createFakeHandleStore } from './handle-store.fake';

const target = (mtime: number | null = 1) =>
  ({
    handle: {} as FileSystemFileHandle,
    lastSavedMtime: mtime,
  }) as const;

// jsdom は IndexedDB を持たない。保存フローの途中でこれを引く以上、使えない
// 環境で例外を投げたり固まったりしてはいけない(記憶できないことは機能低下で
// あって障害ではない ─ 従来どおりピッカーが出るだけ)。
describe('createHandleStore without IndexedDB', () => {
  it('degrades to remembering nothing instead of throwing', async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const store = createHandleStore();

    await expect(store.put('/a.md', target())).resolves.toBeUndefined();
    await expect(store.get('/a.md')).resolves.toBeNull();
    await expect(store.count()).resolves.toBe(0);
  });

  // 独立レビューの指摘: `clear()` だけは失敗を隠してはいけない。
  // `PRIVACY.md` が「いつでも消せます…すべて削除します」と約束しているので、
  // 消せていないのに「消しました」と表示するのは公開文書への裏切りになる。
  // 以前は他のメソッドと同じ best-effort 実装で、`App.tsx` の catch は
  // 到達不能な死んだコードだった。
  it('reports failure from clear() instead of pretending it succeeded', async () => {
    await expect(createHandleStore().clear()).rejects.toThrow();
  });

  it('resolves promptly rather than waiting out the open timeout', async () => {
    // `indexedDB` そのものが無い場合は同期的に諦めるので、2秒の
    // タイムアウトを待たずに解決する。
    const started = Date.now();
    await createHandleStore().get('/a.md');
    expect(Date.now() - started).toBeLessThan(500);
  });
});

// ダブル自体が `HandleStore` の契約どおりに振る舞うことを固定しておく
// (controller のテストはこの上に載るため)。
describe('createFakeHandleStore', () => {
  it('stores, counts and clears per path', async () => {
    const store = createFakeHandleStore();
    expect(await store.get('/a.md')).toBeNull();

    await store.put('/a.md', target(10));
    await store.put('/b.md', target(20));
    expect(await store.count()).toBe(2);
    expect((await store.get('/a.md'))?.lastSavedMtime).toBe(10);

    await store.put('/a.md', target(30));
    expect(await store.count()).toBe(2); // 上書きであって追加ではない
    expect((await store.get('/a.md'))?.lastSavedMtime).toBe(30);

    await store.clear();
    expect(await store.count()).toBe(0);
    expect(await store.get('/a.md')).toBeNull();
  });
});
