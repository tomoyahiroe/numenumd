import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';
import katex from 'katex';

// ユーザー操作(`$$` 入力・スラッシュメニュー)で「いま」作られた mathBlock は
// 即編集モードで開きたい。一方、ファイル読み込みで復元された空の mathBlock が
// フォーカスを奪ってはならない。NodeView 生成時にはトランザクションの出自が
// 分からないため、作成経路がこのフラグを立て、直後の NodeView 生成が消費する。
let openNextMathBlockInEdit = false;

export function markNextMathBlockForEdit(): void {
  openNextMathBlockInEdit = true;
}

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
        getAttributes: () => {
          markNextMathBlockForEdit();
          return { latex: '' };
        },
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
        markNextMathBlockForEdit();
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

      // 'display' | 'edit'。クリックリスナは構築時に1本だけ張り、モードで
      // 振り分ける({once:true} を renderDisplay のたびに積む方式は、update()
      // 経由の再描画でリスナが重複し多重 renderEdit の原因になる)。
      let mode: 'display' | 'edit' = 'display';

      const renderDisplay = () => {
        mode = 'display';
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
      };

      dom.addEventListener('click', () => {
        if (mode === 'display') renderEdit();
      });

      // 編集確定後にカーソルをブロック直後の段落へ移す(無ければ作る)。
      // これが無いと確定後にカーソルがどこにも置かれず、続きを書くために
      // マウス操作(ギャップカーソル探し)が必要になってしまう。
      const exitToNextParagraph = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const node = editor.view.state.doc.nodeAt(pos);
        const after = pos + (node?.nodeSize ?? currentNode.nodeSize);
        editor
          .chain()
          .command(({ tr }) => {
            const $after = tr.doc.resolve(after);
            if ($after.nodeAfter?.type.name !== 'paragraph') {
              tr.insert(after, tr.doc.type.schema.nodes.paragraph!.create());
            }
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            return true;
          })
          .focus()
          .run();
      };

      const renderEdit = () => {
        mode = 'edit';
        dom.innerHTML = '';
        const textarea = document.createElement('textarea');
        textarea.className = 'numenumd-math-block-edit';
        textarea.value = currentNode.attrs.latex;
        dom.appendChild(textarea);
        // NodeView 生成直後は dom がまだドキュメントに挿入されておらず
        // 同期 focus() が空振りするため、アタッチ完了後に focus する。
        queueMicrotask(() => textarea.focus());

        // commit() が引き起こす update()(renderDisplay で textarea を除去)や
        // exit 時のエディタ focus で blur が二重に発火するため、一度 finish
        // したら以降の blur を無視する。
        let done = false;
        const finish = (exit: boolean) => {
          if (done) return;
          done = true;
          commit(textarea.value);
          // 内容が変わっていない場合、commit の setNodeMarkup は同一 attrs の
          // ノード置換になり ProseMirror が update() を呼ばない(node.eq で
          // 既存 NodeView を再利用する)ため、ここで明示的に表示モードへ戻す。
          // 変更があった場合は直後の update() が最新 attrs で再描画するので、
          // この呼び出しは一瞬の同値描画にしかならず無害。
          renderDisplay();
          if (exit) exitToNextParagraph();
        };

        textarea.addEventListener('blur', () => finish(false));
        textarea.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            finish(true);
            return;
          }
          if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
            ev.preventDefault();
            finish(true);
          }
        });
      };

      if (openNextMathBlockInEdit && currentNode.attrs.latex === '') {
        openNextMathBlockInEdit = false;
        renderEdit();
      } else {
        renderDisplay();
      }

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
