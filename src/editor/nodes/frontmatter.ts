import { Node, mergeAttributes } from '@tiptap/core';

export const Frontmatter = Node.create({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  addAttributes() {
    return { content: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-frontmatter]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-frontmatter': '' }),
      node.attrs.content,
    ];
  },
});
