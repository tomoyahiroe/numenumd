import { InputRule, Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
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
    return {
      latex: { default: '' },
      // 元の Markdown が1行完結形(`$$…$$`)だったか。`serialize.ts` がこれを見て
      // 1行で書き戻すため、`.md` を開いて保存しただけで数式の行数が変わることを
      // 防げる(Prettier は `$$Y = X + a$$` を段落として扱いこの行に触らないので、
      // 3行へ正規化すると numenumd だけが起こす差分になってしまう)。
      singleLine: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-single-line'),
        renderHTML: (attrs) =>
          attrs.singleLine ? { 'data-single-line': '' } : {},
      },
    };
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
      // 1行完結形 `$$latex$$` を打ち切ったときも数式ブロックにする
      // (ファイルから読み込んだ場合の `parse.ts` の `mathBlockRule` と揃える)。
      // 上の `$$` + スペースと違い latex が既に入っているので、編集モードでは
      // 開かず(= `markNextMathBlockForEdit()` を呼ばず)そのまま描画する。
      // 書いた形を保つため `singleLine` を立てる。
      //
      // `nodeInputRule` を使わないのは、キャプチャグループがある場合に
      // 「マッチ部分だけをインラインノードへ差し替える」経路
      // (`tr.insertText` + `tr.replaceWith`)に入ってしまい、ブロックノードでは
      // 位置がずれて壊れるため。段落まるごとを mathBlock で置き換える。
      new InputRule({
        find: /^\$\$([^$\n]+)\$\$$/,
        handler: ({ state, range, match, chain }) => {
          const $from = state.doc.resolve(range.from);
          // `find` は行頭からカーソル位置までしか見ないので、カーソルの後ろに
          // 文字が残っている段落がありうる。段落ごと置き換える以上、それを
          // 巻き込んで消してしまうため対象外にする。
          const tail = $from.parent.textBetween(
            range.to - $from.start(),
            $from.parent.content.size,
          );
          if (tail.length > 0) return;
          const latex = match[1] ?? '';
          const from = $from.before();
          const to = $from.after();
          chain()
            .command(({ tr }) => {
              tr.replaceWith(
                from,
                to,
                this.type.create({ latex, singleLine: true }),
              );
              return true;
            })
            .run();
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
        const latex = String(currentNode.attrs.latex ?? '');
        if (latex.trim() === '') {
          // 空の数式を KaTeX に描かせると何も出力されず、NodeView が padding 分の
          // 高さしか持たない不可視の帯になる。クリックして編集モードに入ることも
          // 事実上できなくなるため、代わりに見えるプレースホルダを出す。
          // 空でも自動削除はしない ─ 元から `$$␤␤$$` を含むファイルがありうる
          // (「ユーザーの Markdown を絶対に失わない」原則)。消したいときは
          // 編集モードで Backspace(deleteSelf)。
          const empty = document.createElement('span');
          empty.className = 'numenumd-math-block-empty';
          empty.textContent = '空の数式ブロック';
          container.appendChild(empty);
        } else {
          try {
            katex.render(latex, container, {
              displayMode: true,
              throwOnError: false,
            });
          } catch {
            container.textContent = latex;
          }
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

      // ノードごと削除してカーソルを削除位置に置く。
      //
      // NodeView が `stopEvent: () => true` を返すため ProseMirror は math block 上の
      // mousedown を受け取れず、マウスでノードを選択して消すことができない
      // (クリックは下の click リスナが編集モードに使ってしまう)。キーボードで
      // 直後の段落から Backspace する経路だけは以前から動くが、それを示す表示は
      // 何も無い。そこで「編集モードで中身を空にして Backspace」という、
      // マウスだけで辿り着ける削除手段を用意する。
      const deleteSelf = () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const size =
          editor.view.state.doc.nodeAt(pos)?.nodeSize ?? currentNode.nodeSize;
        editor
          .chain()
          .command(({ tr }) => {
            tr.delete(pos, pos + size);
            tr.setSelection(
              TextSelection.near(
                tr.doc.resolve(Math.min(pos, tr.doc.content.size)),
              ),
            );
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
          // 中身が空のときの Backspace / Delete はブロックごと削除する。
          // `done` を dispatch より**先**に立てるのが必須: ノードを消すと
          // NodeView が破棄されて textarea が DOM から外れ blur が発火するため、
          // 立てておかないと finish(false) が既に存在しない位置へ
          // setNodeMarkup しようとする。
          if (
            (ev.key === 'Backspace' || ev.key === 'Delete') &&
            textarea.value === ''
          ) {
            ev.preventDefault();
            done = true;
            deleteSelf();
            return;
          }
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
