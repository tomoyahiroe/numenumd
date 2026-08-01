import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './extensions';

const makeEditor = () => new Editor({ extensions: buildExtensions() });

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
