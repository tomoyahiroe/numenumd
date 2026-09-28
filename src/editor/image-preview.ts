import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { findImageSpans } from '../markdown/verbatim-spans';
import {
  normalizeRefLabel,
  parseImageSpan,
  parseRefDefinitions,
  resolveImageDest,
  type RefDefinition,
} from '../markdown/image-source';

/**
 * Shows local images for `![alt](path)` text without changing the document.
 *
 * Image syntax stays verbatim text in the doc (the parser keeps it that way so
 * the saved Markdown never changes). This plugin only adds decorations:
 * - an inline decoration that hides the source while the selection isn't
 *   touching it (the same feel as inline math), and
 * - a widget after it with the `<img>`, or a badge for remote images (never
 *   loaded: numenumd makes no network requests) and for files that fail to load.
 */

type ImagePreviewState = {
  decorations: DecorationSet;
  failed: ReadonlySet<string>;
};
type Meta = { failed: string };

export const imagePreviewKey = new PluginKey<ImagePreviewState>(
  'numenumdImagePreview',
);

function collectRefs(doc: PMNode): Map<string, RefDefinition> {
  const refs = new Map<string, RefDefinition>();
  doc.descendants((node) => {
    if (node.type.name !== 'rawBlock') return true;
    const content = String(node.attrs.content ?? '');
    for (const [key, def] of parseRefDefinitions(content)) {
      if (!refs.has(key)) refs.set(key, def);
    }
    return false;
  });
  return refs;
}

function badge(text: string, dest: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'numenumd-image-badge';
  el.textContent = text;
  el.title = dest;
  el.contentEditable = 'false';
  return el;
}

function build(
  state: EditorState,
  pageUrl: string,
  failed: ReadonlySet<string>,
): DecorationSet {
  const decorations: Decoration[] = [];
  const refs = collectRefs(state.doc);
  const { from: selFrom, to: selTo } = state.selection;

  state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'codeBlock') return false;
    if (!node.isText || !node.text) return true;
    if (parent?.type.name === 'codeBlock') return false;
    if (node.marks.some((m) => m.type.name === 'code')) return false;

    for (const [start, end] of findImageSpans(node.text)) {
      const parsed = parseImageSpan(node.text.slice(start, end));
      if (!parsed) continue;
      let dest: string;
      let title: string | null;
      if (parsed.kind === 'inline') {
        ({ dest, title } = parsed);
      } else {
        const def = refs.get(normalizeRefLabel(parsed.label));
        if (!def) continue;
        ({ dest, title } = def);
      }
      const from = pos + start;
      const to = pos + end;
      const resolved = resolveImageDest(dest, pageUrl);

      if (resolved.kind === 'unsupported') continue;
      if (resolved.kind === 'remote') {
        decorations.push(
          Decoration.widget(to, () => badge('remote image not loaded', dest), {
            side: 1,
            key: `remote:${dest}`,
          }),
        );
        continue;
      }
      if (failed.has(resolved.url)) {
        decorations.push(
          Decoration.widget(to, () => badge('image not found', dest), {
            side: 1,
            key: `missing:${resolved.url}`,
          }),
        );
        continue;
      }

      const touching = selFrom <= to && selTo >= from;
      if (!touching) {
        decorations.push(
          Decoration.inline(from, to, {
            class: 'numenumd-image-source--hidden',
          }),
        );
      }
      const { url } = resolved;
      const alt = parsed.alt;
      decorations.push(
        Decoration.widget(
          to,
          (view: EditorView) => {
            const img = document.createElement('img');
            img.className = 'numenumd-image';
            img.alt = alt;
            if (title !== null) img.title = title;
            img.addEventListener('error', () => {
              view.dispatch(
                view.state.tr.setMeta(imagePreviewKey, {
                  failed: url,
                } satisfies Meta),
              );
            });
            img.src = url;
            return img;
          },
          { side: 1, key: `img:${url}:${alt}:${title ?? ''}` },
        ),
      );
    }
    return false;
  });

  return DecorationSet.create(state.doc, decorations);
}

export const ImagePreview = Extension.create<{ getPageUrl: () => string }>({
  name: 'numenumdImagePreview',

  addOptions() {
    return { getPageUrl: () => window.location.href };
  },

  addProseMirrorPlugins() {
    const { getPageUrl } = this.options;
    return [
      new Plugin<ImagePreviewState>({
        key: imagePreviewKey,
        state: {
          init: (_config, state) => ({
            decorations: build(state, getPageUrl(), new Set()),
            failed: new Set(),
          }),
          apply: (tr, prev, _old, state) => {
            const meta = tr.getMeta(imagePreviewKey) as Meta | undefined;
            const failed = meta
              ? new Set([...prev.failed, meta.failed])
              : prev.failed;
            if (!meta && !tr.docChanged && !tr.selectionSet) return prev;
            return { decorations: build(state, getPageUrl(), failed), failed };
          },
        },
        props: {
          decorations: (state) => imagePreviewKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
