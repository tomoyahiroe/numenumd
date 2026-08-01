import { Node, mergeAttributes } from '@tiptap/core';

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { latex: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': '' }),
      node.attrs.latex,
    ];
  },
});
