# Architecture

This document describes how numenumd works today. It is meant for contributors:
read it before changing the parser, the serializer or the save flow.

## Overview

numenumd is a Chrome (Manifest V3) extension with a single content script. When
Chrome opens a local `.md` file, the content script replaces Chrome's plain-text
view with a WYSIWYG editor, and saving writes formatted Markdown back to the file.

```text
file:///…/notes.md
  → content script            src/content/main.tsx
  → App (React)               src/content/App.tsx
  → Editor (Tiptap)           src/editor/
      ⇅ Markdown ↔ document    src/markdown/parse.ts, serialize.ts, format.ts
  → save via File System Access   src/file/controller.ts
      + remembered save target     src/file/handle-store.ts (IndexedDB)
```

There is no background service worker, no server and no network access.

## Directory layout

| Path                 | What it contains                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `manifest.config.ts` | The extension manifest (built by `@crxjs/vite-plugin`); the version comes from `package.json`                  |
| `src/content/`       | Content-script entry point, the `App` component (header, menu, save handling) and theme logic                  |
| `src/editor/`        | The Tiptap editor, its extension list and CSS                                                                  |
| `src/editor/nodes/`  | Custom nodes: math block, raw block, frontmatter, table                                                        |
| `src/editor/slash/`  | The `/` slash menu (items and suggestion UI)                                                                   |
| `src/markdown/`      | Markdown parsing (markdown-it → document JSON), serialization (prosemirror-markdown) and formatting (Prettier) |
| `src/file/`          | Saving through the File System Access API, and the remembered save target                                      |
| `src/keymap/`        | A small priority-ordered key router shared by the editor and the page                                          |
| `tests/fixtures/`    | Markdown samples used by round-trip tests                                                                      |
| `tools/screenshots/` | The harness that generates the README screenshots in `docs/images/`                                            |
| `scripts/`           | Build helpers: icon generation, and a check that Chrome will accept the built content script                   |

## Page takeover

The manifest registers one content script for `file:///*` with the include glob
`*.md`, running at `document_idle`. By then Chrome has rendered the plain-text
file as a document containing a single `<pre>`.

`src/content/main.tsx` checks that the path ends in `.md` (so other `file://`
pages are left alone), reads the `<pre>`'s text as the raw Markdown, clears the
page and mounts the React `App` with the Markdown and the file name.

Chrome only runs content scripts on `file://` pages when the user turns on
**Allow access to file URLs** for the extension; without it, the page stays as
plain text.

## Markdown round-trip

The core rule of the project is: **the user's Markdown is never lost.** Anything
the editor can't represent is kept verbatim and written back unchanged.

**Parsing** (`src/markdown/parse.ts`, `parseMarkdown`) runs markdown-it with extra
rules and converts its tokens into Tiptap/ProseMirror document JSON:

- **Frontmatter**: a leading `---` YAML block becomes a `frontmatter` node and is
  written back byte for byte (`src/markdown/frontmatter.ts`).
- **Math**: `$$…$$` (multi-line, or on a single line) becomes a `mathBlock` node.
  Inline `$…$` is kept as plain text; whether a `$` pair is math is decided by a
  Pandoc-style heuristic in `src/markdown/math-spans.ts`, shared by the parser,
  the serializer and the editor's KaTeX decoration so the three never disagree.
- **Verbatim spans**: images `![alt](src)` and footnote markers `[^1]` have no
  editor node, so they are cut out as raw text before other inline rules can
  normalize them (`src/markdown/verbatim-spans.ts`).
- **Raw blocks**: HTML blocks, link reference and footnote definitions, and tables
  that GFM would silently truncate (rows with more cells than the header) become a
  `rawBlock` node that holds the original source text. It is shown as-is and
  serialized unchanged.
- If parsing fails for any reason, the whole body becomes a single `rawBlock`
  rather than losing content.

**Serializing** (`src/markdown/serialize.ts`, `serializeMarkdown`) uses
prosemirror-markdown with custom escaping, so that math, verbatim spans, task
markers and table cells are not over-escaped. Table cells are split and escaped by
`src/markdown/table-cells.ts`.

**Formatting** (`src/markdown/format.ts`, `docToMd`) runs Prettier (standalone,
markdown parser, `proseWrap: 'preserve'`) on the body only. The frontmatter is
split off first and re-attached afterwards, so Prettier never rewrites it.
Formatting is idempotent: saving again without edits produces the same file.

## Editor extensions

`src/editor/extensions.ts` builds the Tiptap extension list:

- StarterKit (headings 1–6, lists, quotes, code blocks, marks), task lists, and
  links with titles preserved.
- Extra shortcuts: `Mod-k` for links and `Mod-Shift-x` for strikethrough, in
  addition to the defaults. `Mod` is Cmd on macOS and Ctrl elsewhere.
- KaTeX rendering of inline math through `@tiptap/extension-mathematics`, using
  the same span detection as the parser.
- Custom nodes: `MathBlock` (click to edit its LaTeX; `Escape` or `Cmd/Ctrl+Enter`
  to finish), `RawBlock`, `Frontmatter` (collapsible), and the table nodes with
  their node view (add rows and columns with `+` buttons, select a row or column
  from its grip and delete it with Backspace).
- The slash menu (`src/editor/slash/`), opened by typing `/`.

**Key routing** (`src/keymap/`): `KeyRouter` runs registered handlers in priority
order. The editor forwards key events to it through a highest-priority ProseMirror
plugin, and the `App` also listens at the document level, so `Cmd/Ctrl+S` is
caught even when the editor doesn't have focus (instead of opening Chrome's "Save
page" dialog). Today its only registered handler is save.

## Saving and the remembered save target

`src/file/controller.ts` (`FileController`) owns saving one document:

1. The first `Cmd/Ctrl+S` opens the system save picker, with the file name filled
   in. The picker `id` is derived from the file's folder
   (`src/file/picker-id.ts`), so Chrome reopens the picker in the folder used last
   time for that folder.
2. Later saves write silently to the same file handle.
3. Before overwriting, it compares the file's modification time on disk with the
   one recorded after its own last write. If another app changed the file, the
   `App` asks before overwriting.
4. If Chrome revokes write permission, the handle is dropped and the next save
   starts over. Nothing is written in the failed attempt.

The `App` serializes a snapshot of the document before saving and only clears the
"unsaved" state if nothing changed while the save was in progress. With unsaved
changes, the tab title starts with `●` and closing the tab shows the browser's
leave-page warning.

**The remembered save target** (`src/file/handle-store.ts`) is an IndexedDB
database (`numenumd`, object store `saveTargets`) keyed by the file's path. For
each successfully saved file it stores the `FileSystemFileHandle` and the file's
modification time right after the save. After a reload, the first save
re-requests permission on the remembered handle instead of opening the picker.
Remembering is best-effort: any failure falls back to the picker.

This record is the **only** persistent state numenumd itself reads or writes. The
document text is never stored, and the theme choice is not persisted. The browser
separately keeps state numenumd can't read: the save picker's last-used folder
(per picker `id`) and File System Access permissions.

All `file://` pages share one storage origin in Chrome, so another local HTML page
could read the list of remembered paths; see [PRIVACY.md](../PRIVACY.md). The "⋯"
menu in the editor header ("記憶した保存先を消す", forget remembered save
locations) clears the whole record.

## Theme

The header button cycles Auto (follow the OS setting) → Light → Dark. The choice is
applied as a data attribute on the root element and is not persisted: every tab
starts at Auto.

## Testing

- Vitest with jsdom. Tests live next to the code as `*.test.ts` / `*.test.tsx`.
- Round-trip tests (`src/markdown/roundtrip.test.ts`): Inline cases check parse
  → serialize equality. The fixtures in `tests/fixtures/` run through the full
  format pipeline: most must match golden output byte for byte, `basic.md` and
  `edge.md` are checked for idempotency (formatting twice gives the same result),
  and known deviations are pinned explicitly. They are the safety net for the "never lose the user's Markdown" rule:
  any parser or serializer change should come with a fixture.
- `npm run build` also runs `scripts/check-dist-encoding.mjs`, which fails the
  build if any bundled JavaScript contains characters Chrome refuses to load in a
  content script (Unicode noncharacters or surrogate sequences).
