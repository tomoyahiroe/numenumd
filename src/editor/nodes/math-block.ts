import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import katex from 'katex';

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { latex: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-math-block]',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).textContent ?? '',
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': '' }),
      node.attrs.latex,
    ];
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /^\$\$\s$/,
        type: this.type,
        getAttributes: () => ({ latex: '' }),
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      // `$$` だけの空段落で Enter を押した場合も mathBlock に変換する
      // (`$$` + space は addInputRules の nodeInputRule で処理されるが、
      // Enter キーは ProseMirror の handleTextInput を経由しないため別途ハンドリングする)
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== 'paragraph') return false;
        if ($from.parent.textContent !== '$$') return false;
        const from = $from.before();
        const to = $from.after();
        return this.editor
          .chain()
          .command(({ tr }) => {
            tr.replaceWith(from, to, this.type.create({ latex: '' }));
            return true;
          })
          .run();
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;

      const dom = document.createElement('div');
      dom.classList.add('numenumd-math-block');
      dom.setAttribute('data-math-block', '');
      dom.contentEditable = 'false';

      const commit = (latex: string) => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            latex,
          }),
        );
      };

      const renderDisplay = () => {
        dom.innerHTML = '';
        const container = document.createElement('div');
        container.classList.add('numenumd-math-block-rendered');
        try {
          katex.render(currentNode.attrs.latex, container, {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          container.textContent = currentNode.attrs.latex;
        }
        dom.appendChild(container);
        dom.addEventListener('click', renderEdit, { once: true });
      };

      const renderEdit = () => {
        dom.innerHTML = '';
        const textarea = document.createElement('textarea');
        textarea.className = 'numenumd-math-block-edit';
        textarea.value = currentNode.attrs.latex;
        dom.appendChild(textarea);
        textarea.focus();

        const finish = () => {
          commit(textarea.value);
        };

        textarea.addEventListener('blur', finish);
        textarea.addEventListener('keydown', (ev) => {
          if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
            ev.preventDefault();
            finish();
          }
        });
      };

      renderDisplay();

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'mathBlock') return false;
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
