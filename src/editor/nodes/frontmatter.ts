import { Node, mergeAttributes } from '@tiptap/core';

export const Frontmatter = Node.create({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  addAttributes() {
    return { content: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-frontmatter]',
        getAttrs: (el) => ({
          content: (el as HTMLElement).textContent ?? '',
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-frontmatter': '' }),
      node.attrs.content,
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;

      const dom = document.createElement('div');
      dom.setAttribute('data-frontmatter', '');
      dom.contentEditable = 'false';

      const commit = (content: string) => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            content,
          }),
        );
      };

      const renderDisplay = () => {
        dom.innerHTML = '';
        const details = document.createElement('details');
        details.className = 'numenumd-frontmatter';
        const summary = document.createElement('summary');
        summary.textContent = 'Front matter';
        const pre = document.createElement('pre');
        pre.textContent = currentNode.attrs.content;
        pre.addEventListener('click', (ev) => {
          ev.preventDefault();
          renderEdit();
        });
        details.appendChild(summary);
        details.appendChild(pre);
        details.open = true;
        dom.appendChild(details);
      };

      const renderEdit = () => {
        dom.innerHTML = '';
        const details = document.createElement('details');
        details.className = 'numenumd-frontmatter';
        details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = 'Front matter';
        const textarea = document.createElement('textarea');
        textarea.className = 'numenumd-frontmatter-edit';
        textarea.value = currentNode.attrs.content;
        details.appendChild(summary);
        details.appendChild(textarea);
        dom.appendChild(details);
        textarea.focus();
        textarea.addEventListener('blur', () => commit(textarea.value));
      };

      renderDisplay();

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'frontmatter') return false;
          currentNode = updatedNode;
          renderDisplay();
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
      };
    };
  },
});
