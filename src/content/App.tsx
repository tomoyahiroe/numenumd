import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { JSONContent } from '@tiptap/core';
import { parseMarkdown } from '../markdown/parse';
import { docToMd } from '../markdown/format';
import { MarkdownEditor } from '../editor/Editor';
import { KeyRouter } from '../keymap/router';
import { FileController } from '../file/controller';
import { pickerIdForPath } from '../file/picker-id';

type Props = { rawMarkdown: string; filename: string };

function messageFor(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function App({ rawMarkdown, filename }: Props) {
  const initialDoc = useMemo(() => parseMarkdown(rawMarkdown), [rawMarkdown]);
  const router = useMemo(() => new KeyRouter(), []);
  const fc = useMemo(
    () => new FileController(filename, pickerIdForPath(location.pathname)),
    [filename],
  );
  const docRef = useRef<JSONContent>(initialDoc);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const save = useCallback(async () => {
    if (!dirty) return;

    // 保存対象のスナップショットを固定する。この後 docToMd / fc.save の
    // 複数の await を挟む間にユーザーがさらに編集すると docRef.current は
    // 新しいオブジェクトに差し替わる(onDocChange は常に新規オブジェクトを
    // 渡す)ので、保存完了時に docRef.current がこのスナップショットのまま
    // かどうかを参照同一性だけで判定できる。異なっていれば「保存後に
    // 反映されていない編集がある」ということなので dirty を落としてはいけない
    // (落とすと、その編集は画面上は非 dirty に見えたままメモリにしか残らず、
    // beforeunload の警告も出ず、次の Cmd+S も !dirty で何もしないため、
    // タブを閉じると無警告でデータが消える)。
    const snapshot = docRef.current;

    // ユーザーの Markdown を絶対に失わないため、シリアライズ/整形に失敗した
    // 場合は空文字列や部分文字列を絶対に fc.save() へ渡さず、ここで打ち切る。
    // dirty はそのまま維持し、ユーザーに再試行の機会を残す。
    let md: string;
    try {
      md = await docToMd(snapshot);
    } catch (e) {
      flashToast(`変換に失敗しました: ${messageFor(e)}`);
      return;
    }

    try {
      let result = await fc.save(md);
      if (result === 'conflict') {
        if (
          confirm('ファイルが他のアプリで変更されています。上書きしますか?')
        ) {
          result = await fc.confirmOverwrite(md);
        } else {
          flashToast('保存をキャンセルしました');
          return;
        }
      }
      if (result === 'saved') {
        if (docRef.current === snapshot) {
          setDirty(false);
        }
        flashToast('保存しました');
      }
      if (result === 'cancelled') {
        flashToast('保存をキャンセルしました');
      }
    } catch (e) {
      // FileController から NotAllowedError 以外の write 例外(NotFound /
      // QuotaExceeded 等)が素通しで飛んでくることがある。ここで catch して
      // トースト表示し、dirty は落とさない(保存失敗が沈黙しないように)。
      flashToast(`保存に失敗しました: ${messageFor(e)}`);
    }
  }, [dirty, fc, flashToast]);

  useEffect(
    () =>
      router.register(100, (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
          ev.preventDefault();
          void save();
          return true;
        }
        return false;
      }),
    [router, save],
  );

  // KeyRouter は ProseMirror の handleKeyDown 経由でしか届かないため、
  // エディタにフォーカスが無い状態(ヘッダやガター等、720px のエディタ幅の
  // 外側をクリックした後)の Cmd+S は素通ししてしまい、Chrome 既定の
  // 「ページを保存」ダイアログが開いてしまう。document レベルにも同じ
  // router へ委譲するフォールバックの keydown リスナを張ることで、
  // フォーカス位置によらず Cmd+S を確実に横取りする。
  //
  // エディタにフォーカスがある場合は ProseMirror の handleKeyDown が先に
  // イベントを処理して ev.preventDefault() を呼ぶ(イベントターゲットである
  // `.ProseMirror` 自身に張られたリスナのため、bubble フェーズで document に
  // 届くより前に発火する)。そのイベントは preventDefault 済みのまま
  // document まで bubble してくるので、ここで `ev.defaultPrevented` を見て
  // 二重に route してしまう(= 保存が2回走る)のを防ぐ。
  useEffect(() => {
    const onDocumentKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented) return;
      router.route(ev);
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [router]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    document.title = (dirty ? '● ' : '') + filename;
  }, [dirty, filename]);

  return (
    <div className="numenumd-app">
      <header className="numenumd-header">
        <span>{filename}</span>
        {dirty && (
          <span data-testid="dirty-dot" className="numenumd-dirty">
            ●
          </span>
        )}
      </header>
      <MarkdownEditor
        initialDoc={initialDoc}
        router={router}
        onDocChange={(doc) => {
          docRef.current = doc;
          setDirty(true);
        }}
      />
      {toast && <div className="numenumd-toast">{toast}</div>}
    </div>
  );
}
