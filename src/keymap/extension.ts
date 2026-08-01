import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { KeyRouter } from './router';

export function KeymapExtension(router: KeyRouter) {
  return Extension.create({
    name: 'numenumdKeymap',
    priority: 10000, // 最優先で他拡張より先に handleKeyDown を受ける
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('numenumdKeyRouter'),
          props: {
            handleKeyDown: (_view, ev) => router.route(ev),
          },
        }),
      ];
    },
  });
}
