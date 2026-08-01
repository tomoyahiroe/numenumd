import { Node, mergeAttributes } from '@tiptap/core';

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { content: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-raw-block]',
        getAttrs: (el) => ({
          content: (el as HTMLElement).textContent ?? '',
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-raw-block': '' }),
      node.attrs.content,
    ];
  },
});
