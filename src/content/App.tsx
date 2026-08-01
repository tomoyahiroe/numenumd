import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { JSONContent } from '@tiptap/core';
import { parseMarkdown } from '../markdown/parse';
import { docToMd } from '../markdown/format';
import { MarkdownEditor } from '../editor/Editor';
import { KeyRouter } from '../keymap/router';
import { FileController } from '../file/controller';

type Props = { rawMarkdown: string; filename: string };

function messageFor(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function App({ rawMarkdown, filename }: Props) {
  const initialDoc = useMemo(() => parseMarkdown(rawMarkdown), [rawMarkdown]);
  const router = useMemo(() => new KeyRouter(), []);
  const fc = useMemo(() => new FileController(filename), [filename]);
  const docRef = useRef<JSONContent>(initialDoc);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const save = useCallback(async () => {
    if (!dirty) return;

    // ユーザーの Markdown を絶対に失わないため、シリアライズ/整形に失敗した
    // 場合は空文字列や部分文字列を絶対に fc.save() へ渡さず、ここで打ち切る。
    // dirty はそのまま維持し、ユーザーに再試行の機会を残す。
    let md: string;
    try {
      md = await docToMd(docRef.current);
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
        setDirty(false);
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
