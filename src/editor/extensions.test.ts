import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './extensions';

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
      attrs: { latex: 'E = mc^2' },
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

  it('frontmatter restores content when parsed back from its rendered HTML', () => {
    const editor = makeEditor();
    editor.commands.setContent('<div data-frontmatter>title: Hello</div>');
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'frontmatter',
      attrs: { content: 'title: Hello' },
    });
  });
});
