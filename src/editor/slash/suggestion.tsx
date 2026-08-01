import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { filterSlashItems, type SlashItem } from './items';

/**
 * Notion 風のスラッシュコマンドメニュー本体。
 * `ArrowUp`/`ArrowDown`/`Enter` は suggestion の `onKeyDown` から
 * `useImperativeHandle` 経由で呼び出す(Tiptap 公式 suggestion リファレンス実装と同じ構造)。
 */
export type SlashMenuProps = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

export type SlashMenuHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) {
          // 0件マッチ時は Enter だけ消費してメニューを閉じる。消費しないと
          // エディタ本体の Enter(改行/splitBlock)が発火してしまい、
          // `/zzz` のようなテキストが残ったまま意図しない改行が入る。
          return event.key === 'Enter';
        }

        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="numenumd-slash-menu">
          <div className="numenumd-slash-menu-empty">No results</div>
        </div>
      );
    }

    return (
      <div className="numenumd-slash-menu">
        {items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            className={
              'numenumd-slash-menu-item' +
              (index === selectedIndex ? ' is-selected' : '')
            }
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => selectItem(index)}
          >
            {item.title}
          </button>
        ))}
      </div>
    );
  },
);
SlashMenu.displayName = 'SlashMenu';

export const renderSlashMenu: SuggestionOptions<
  SlashItem,
  SlashItem
>['render'] = () => {
  // Tiptap の Suggestion プラグインは `view.update` が `async` 関数で、
  // `items()` の `await` を境に onStart の本体(component/popup の生成)が
  // 次のマイクロタスクへ遅延される。そのため、理論上は同一 tick 内で
  // onUpdate/onKeyDown/onExit が onStart の完了より先に呼ばれる余地があり、
  // `component`/`popup` はどの時点でも未生成の可能性がある前提で扱う。
  let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | undefined;
  let popup: TippyInstance[] | undefined;

  const ensurePopup = (clientRect: () => DOMRect | null) => {
    if (popup || !component) return;
    popup = tippy('body', {
      getReferenceClientRect: () => clientRect() ?? new DOMRect(0, 0, 0, 0),
      appendTo: () => document.body,
      content: component.element,
      showOnCreate: true,
      interactive: true,
      trigger: 'manual',
      placement: 'bottom-start',
    });
  };

  const destroyAll = () => {
    popup?.[0]?.destroy();
    popup = undefined;
    component?.destroy();
    component = undefined;
  };

  return {
    onStart: (props) => {
      // `renderSlashMenu()` はエディタごとに一度しか呼ばれず、この
      // クロージャは開く/閉じるを繰り返すあいだ使い回される。前回セッションの
      // 後始末が(何らかの理由で)漏れていた場合に備え、開始時にも念のため
      // 古い参照を破棄しておく。
      destroyAll();

      component = new ReactRenderer(SlashMenu, {
        props: { items: props.items, command: props.command },
        editor: props.editor,
      });

      if (!props.clientRect) return;

      ensurePopup(props.clientRect);
    },

    onUpdate(props) {
      component?.updateProps({ items: props.items, command: props.command });

      if (!props.clientRect) return;

      if (!popup) {
        ensurePopup(props.clientRect);
        return;
      }

      popup[0]?.setProps({
        getReferenceClientRect: () =>
          props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
      });
    },

    onKeyDown(props) {
      if (props.event.key === 'Escape') {
        popup?.[0]?.hide();
        return true;
      }

      return component?.ref?.onKeyDown(props) ?? false;
    },

    onExit() {
      destroyAll();
    },
  };
};

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        // `props` はメニューで選択された SlashItem。`SuggestionProps.command`
        // 経由で呼ばれ、この時点の editor/range で item 自身の command を実行する。
        command: ({ editor, range, props }) => {
          props.command(editor, range);
        },
        items: ({ query }: { query: string }) => filterSlashItems(query),
        render: renderSlashMenu,
      } as Omit<SuggestionOptions<SlashItem, SlashItem>, 'editor'>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

export default SlashCommand;
