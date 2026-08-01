import type { Editor, Range } from '@tiptap/core';

export type SlashItem = {
  title: string;
  keywords: string[];
  command: (editor: Editor, range: Range) => void;
};

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Heading 1',
    keywords: ['heading', 'h1', '見出し'],
    command: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 1 })
        .run();
    },
  },
  {
    title: 'Heading 2',
    keywords: ['heading', 'h2', '見出し'],
    command: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 2 })
        .run();
    },
  },
  {
    title: 'Heading 3',
    keywords: ['heading', 'h3', '見出し'],
    command: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode('heading', { level: 3 })
        .run();
    },
  },
  {
    title: 'Bulleted list',
    keywords: ['bullet', 'ul', 'list', '箇条書き'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered list',
    keywords: ['numbered', 'ol', 'ordered', '番号'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: 'To-do list',
    keywords: ['todo', 'task', 'check', 'checkbox', 'チェック'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: 'Quote',
    keywords: ['quote', 'blockquote', '引用'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: 'Code block',
    keywords: ['code', 'codeblock', 'コード'],
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: 'Math block',
    keywords: ['math', 'latex', 'equation', '数式'],
    command: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mathBlock', attrs: { latex: '' } })
        .run();
    },
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (q === '') return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}
