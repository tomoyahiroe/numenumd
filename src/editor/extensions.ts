import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Mathematics from '@tiptap/extension-mathematics';
import { MathBlock } from './nodes/math-block';
import { RawBlock } from './nodes/raw-block';
import { Frontmatter } from './nodes/frontmatter';

export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false }),
    Mathematics, // インライン $…$ を KaTeX デコレーションで描画
    MathBlock,
    RawBlock,
    Frontmatter,
  ];
}
