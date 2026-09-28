// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { RawBlock } from './nodes/raw-block';
import { ImagePreview } from './image-preview';
import { parseMarkdown } from '../markdown/parse';

const PAGE = 'file:///Users/me/notes/doc.md';
let editor: Editor | null = null;

function make(md: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      RawBlock,
      ImagePreview.configure({ getPageUrl: () => PAGE }),
    ],
    content: parseMarkdown(md),
  });
  return editor;
}
const dom = () => editor!.view.dom as HTMLElement;
const imgs = () =>
  Array.from(
    dom().querySelectorAll('img.numenumd-image'),
  ) as HTMLImageElement[];
const badges = () =>
  Array.from(dom().querySelectorAll('.numenumd-image-badge')).map(
    (b) => b.textContent,
  );
const hidden = () =>
  dom().querySelectorAll('.numenumd-image-source--hidden').length;
/** Position of `needle`'s first character inside the first paragraph. */
const posOf = (needle: string) =>
  1 + editor!.state.doc.firstChild!.textContent.indexOf(needle);

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('ImagePreview', () => {
  it('renders a local image and hides its source when the cursor is elsewhere', () => {
    make('See ![a cat](img/cat.png "Cat") end');
    editor!.commands.setTextSelection(posOf('end') + 2);
    expect(imgs()).toHaveLength(1);
    expect(imgs()[0]!.getAttribute('src')).toBe(
      'file:///Users/me/notes/img/cat.png',
    );
    expect(imgs()[0]!.getAttribute('alt')).toBe('a cat');
    expect(imgs()[0]!.getAttribute('title')).toBe('Cat');
    expect(hidden()).toBe(1);
  });

  it('reveals the source when the cursor is inside it, and keeps the image', () => {
    make('See ![a](img/a.png) end');
    editor!.commands.setTextSelection(posOf('img/a.png'));
    expect(hidden()).toBe(0);
    expect(imgs()).toHaveLength(1);
  });

  it('reveals the source when the cursor touches the end of it', () => {
    make('See ![a](img/a.png) end');
    editor!.commands.setTextSelection(posOf(' end'));
    expect(hidden()).toBe(0);
  });

  it('never creates an img for a remote image and shows a badge instead', () => {
    make(
      'Remote ![r](https://example.com/r.png) and ![p](//cdn.example.com/p.png) x',
    );
    editor!.commands.setTextSelection(posOf(' x') + 1);
    expect(dom().querySelectorAll('img')).toHaveLength(0);
    expect(badges()).toEqual([
      'remote image not loaded',
      'remote image not loaded',
    ]);
    expect(hidden()).toBe(0);
  });

  it('never creates an img for a remote URL hidden with a tab, a control character or a file host', () => {
    make(
      'A ![t](<ht\ttps://evil.example/t.png>) B ![c](\u0001https://evil.example/c.png) C ![u](file://evil.example/s/u.png) x',
    );
    expect(dom().querySelectorAll('img')).toHaveLength(0);
    expect(badges()).toEqual([
      'remote image not loaded',
      'remote image not loaded',
      'remote image not loaded',
    ]);
  });

  it('resolves a reference image through its definition', () => {
    make('See ![a][Pic] end\n\n[pic]: pics/a.png "T"\n');
    editor!.commands.setTextSelection(posOf('end') + 2);
    expect(imgs()[0]!.getAttribute('src')).toBe(
      'file:///Users/me/notes/pics/a.png',
    );
  });

  it('treats a remote reference definition as remote', () => {
    make('See ![a][r] end\n\n[r]: https://example.com/a.png\n');
    expect(dom().querySelectorAll('img')).toHaveLength(0);
    expect(badges()).toEqual(['remote image not loaded']);
  });

  it('ignores images inside inline code and code blocks', () => {
    make('Code `![c](c.png)` here\n\n```\n![d](d.png)\n```\n');
    expect(dom().querySelectorAll('img')).toHaveLength(0);
    expect(badges()).toEqual([]);
  });

  it('switches to an "image not found" badge with visible source when loading fails', () => {
    make('See ![a](missing.png) end');
    editor!.commands.setTextSelection(posOf('end') + 2);
    imgs()[0]!.dispatchEvent(new Event('error'));
    expect(imgs()).toHaveLength(0);
    expect(badges()).toEqual(['image not found']);
    expect(hidden()).toBe(0);
    const badge = dom().querySelector('.numenumd-image-badge')!;
    expect(badge.getAttribute('title')).toBe('missing.png');
  });

  it('reuses the img element when text before it shifts its position', () => {
    make('See ![a](img/a.png) end');
    editor!.commands.setTextSelection(posOf('See') + 1);
    const before = imgs()[0];
    editor!.commands.insertContent('XY');
    expect(editor!.state.doc.firstChild!.textContent).toMatch(/^SXYee/);
    expect(imgs()[0]).toBe(before);
  });

  it('reuses the img element across edits after it', () => {
    make('See ![a](img/a.png) end');
    editor!.commands.setTextSelection(posOf('end') + 3);
    const before = imgs()[0];
    editor!.commands.insertContent('!');
    expect(imgs()[0]).toBe(before);
  });

  it('does not change the document', () => {
    const md = 'See ![a](img/a.png) and ![b][r]\n\n[r]: b.png\n';
    const e = make(md);
    expect(e.getJSON()).toEqual(parseMarkdown(md));
  });
});
