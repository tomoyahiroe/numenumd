import { createRoot } from 'react-dom/client';
import { App } from './App';

/**
 * file:// 上の .md ページを乗っ取り、Chrome が生成した既定の `<pre>` 表示を
 * numenumd の WYSIWYG エディタに差し替える。
 *
 * `run_at: 'document_idle'` を前提にしている: Chrome はプレーンテキストの
 * file:// レスポンスを `<pre>` 1個だけのドキュメントとしてレンダリングするが、
 * この `<pre>` が生成されるのを待つ必要があるため(`document_start` では
 * まだ存在しない)。
 */
function boot() {
  if (!location.pathname.toLowerCase().endsWith('.md')) return;

  const pre = document.body.querySelector('pre');
  const rawMarkdown = pre?.textContent ?? '';
  const filename = decodeURIComponent(
    location.pathname.split('/').pop() ?? 'untitled.md',
  );

  document.body.innerHTML = '';
  document.body.style.margin = '0';
  const root = document.createElement('div');
  root.id = 'numenumd-root';
  document.body.appendChild(root);

  createRoot(root).render(
    <App rawMarkdown={rawMarkdown} filename={filename} />,
  );
}

boot();
