import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { useEffect } from 'react';
import { buildExtensions } from './extensions';
import { KeymapExtension } from '../keymap/extension';
import type { KeyRouter } from '../keymap/router';
import './editor.css';

declare global {
  interface Window {
    __numenumdEditor__?: Editor;
  }
}

type Props = {
  initialDoc: JSONContent;
  router: KeyRouter;
  onDocChange: (doc: JSONContent) => void;
};

export function MarkdownEditor({ initialDoc, router, onDocChange }: Props) {
  const editor = useEditor({
    extensions: [...buildExtensions(), KeymapExtension(router)],
    content: initialDoc,
    onUpdate: ({ editor }) => onDocChange(editor.getJSON()),
  });

  useEffect(() => {
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
      window.__numenumdEditor__ = editor ?? undefined;
    }
    return () => {
      if (window.__numenumdEditor__ === editor) {
        window.__numenumdEditor__ = undefined;
      }
    };
  }, [editor]);

  return <EditorContent editor={editor} className="numenumd-editor" />;
}
