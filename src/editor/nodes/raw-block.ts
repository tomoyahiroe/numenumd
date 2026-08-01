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
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;

      const dom = document.createElement('div');
      dom.setAttribute('data-raw-block', '');
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
        const pre = document.createElement('pre');
        pre.className = 'numenumd-raw';
        pre.textContent = currentNode.attrs.content;
        dom.appendChild(pre);
        dom.addEventListener('click', renderEdit, { once: true });
      };

      const renderEdit = () => {
        dom.innerHTML = '';
        const textarea = document.createElement('textarea');
        textarea.className = 'numenumd-raw-edit';
        textarea.value = currentNode.attrs.content;
        dom.appendChild(textarea);
        textarea.focus();
        textarea.addEventListener('blur', () => commit(textarea.value));
      };

      renderDisplay();

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'rawBlock') return false;
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
