import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtensions } from './extensions';
import { parseMarkdown } from '../markdown/parse';
import { serializeMarkdown } from '../markdown/serialize';

// `Editor` は破棄しないと内部の DOM 監視タイマーが動き続け、次のテスト
// ファイルへ環境が切り替わるタイミングで `document is not defined` の
// 未処理例外を断続的に発生させる(既存のフレーク要因)。各テスト後に
// 確実に破棄する。
const createdEditors: Editor[] = [];
const makeEditor = () => {
  const editor = new Editor({ extensions: buildExtensions() });
  createdEditors.push(editor);
  return editor;
};

afterEach(() => {
  while (createdEditors.length > 0) {
    createdEditors.pop()?.destroy();
  }
});

describe('buildExtensions', () => {
  it('registers all node and mark types', () => {
    const editor = makeEditor();
    const { nodes, marks } = editor.schema;
    for (const n of [
      'heading',
      'bulletList',
      'taskList',
      'taskItem',
      'codeBlock',
      'mathBlock',
      'rawBlock',
      'frontmatter',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
    ]) {
      expect(nodes[n], `node ${n}`).toBeDefined();
    }
    for (const m of ['bold', 'italic', 'strike', 'code', 'link']) {
      expect(marks[m], `mark ${m}`).toBeDefined();
    }
  });

  it('mathBlock holds latex as attribute', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'E = mc^2' } }],
    });
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: 'E = mc^2' },
    });
  });

  it('rawBlock round-trips arbitrary text via attrs', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'rawBlock', attrs: { content: '| a | b |\n|---|---|' } },
      ],
    });
    expect(editor.getJSON().content?.[0]?.attrs?.content).toBe(
      '| a | b |\n|---|---|',
    );
  });

  it('mathBlock restores latex when parsed back from its rendered HTML', () => {
    const editor = makeEditor();
    editor.commands.setContent('<div data-math-block>E = mc^2</div>');
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: 'E = mc^2', singleLine: false },
    });
  });

  /**
   * `singleLine`(元の Markdown が1行完結形 `$$…$$` だったか)は HTML 経由でも
   * 保たれる必要がある。コピー&ペーストは HTML を経由するため、ここが落ちると
   * 1行で書かれた数式をコピペしただけで3行に化ける。
   */
  it('mathBlock keeps singleLine across an HTML round trip', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'mathBlock', attrs: { latex: 'Y = X + a', singleLine: true } },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('data-single-line');

    const other = makeEditor();
    other.commands.setContent(html);
    expect(other.getJSON().content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: 'Y = X + a', singleLine: true },
    });
  });

  it('rawBlock restores content when parsed back from its rendered HTML', () => {
    const editor = makeEditor();
    editor.commands.setContent(
      '<div data-raw-block>| a | b |\n|---|---|</div>',
    );
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'rawBlock',
      attrs: { content: '| a | b |\n|---|---|' },
    });
  });

  // GFM のセルにはインラインしか書けない。tiptap 既定の `block+` のままだと
  // セル内にリストやコードブロックを作れてしまい、保存時に必ず表が壊れる。
  it('restricts table cells to a single paragraph', () => {
    const editor = makeEditor();
    for (const name of ['tableCell', 'tableHeader']) {
      const spec = editor.schema.nodes[name]!.spec;
      expect(spec.content, `${name} content`).toBe('paragraph');
    }
  });

  it('gives table cells an alignment attribute so :---: survives a round trip', () => {
    const editor = makeEditor();
    for (const name of ['tableCell', 'tableHeader']) {
      const attrs = editor.schema.nodes[name]!.spec.attrs ?? {};
      expect(attrs.alignment, `${name} alignment`).toBeDefined();
      expect(attrs.alignment?.default ?? null).toBeNull();
    }
  });

  it('frontmatter restores content when parsed back from its rendered HTML', () => {
    const editor = makeEditor();
    editor.commands.setContent('<div data-frontmatter>title: Hello</div>');
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'frontmatter',
      attrs: { content: 'title: Hello' },
    });
  });
});

describe('image preview registration', () => {
  it('is part of buildExtensions()', () => {
    expect(buildExtensions().map((e) => e.name)).toContain(
      'numenumdImagePreview',
    );
  });

  it('does not change the serialized Markdown of the image fixture', () => {
    const md = readFileSync(
      join(__dirname, '../../tests/fixtures/images-footnotes.md'),
      'utf8',
    );
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions(),
      content: parseMarkdown(md),
    });
    createdEditors.push(editor);
    const docSize = editor.state.doc.content.size;
    for (const pos of [1, Math.floor(docSize / 2), docSize - 1]) {
      editor.commands.setTextSelection(pos);
    }
    expect(serializeMarkdown(editor.getJSON())).toBe(
      serializeMarkdown(parseMarkdown(md)),
    );
  });
});
