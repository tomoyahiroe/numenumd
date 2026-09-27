# Contributing to numenumd

Thanks for your interest in numenumd! Bug reports, ideas and pull requests are
all welcome. Issues and pull requests in English are welcome. Some older commit
messages and code comments are in Japanese.

Before changing the parser, the serializer or the save flow, read
[docs/architecture.md](docs/architecture.md).

## Development setup

You need Node.js 22 (the version CI uses) and npm.

```bash
git clone https://github.com/tomoyahiroe/numenumd.git
cd numenumd
npm install
npm run build
```

Load the `dist/` folder in Chrome as described in the README's
[install section](README.md#from-source), and remember to turn on **Allow access
to file URLs**. After rebuilding, click the reload icon on numenumd's card in
`chrome://extensions` and reload the `.md` tab.

`npm run dev` starts the Vite dev server with hot reload for extension
development.

## Commands

| Command                     | What it does                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`               | Vite dev server with hot reload                                                           |
| `npm run build`             | Type check, production build into `dist/`, and a check that Chrome will accept the bundle |
| `npm test`                  | Run all tests once (Vitest)                                                               |
| `npm run test:watch`        | Run tests in watch mode                                                                   |
| `npm run lint`              | ESLint on `src/`                                                                          |
| `npm run typecheck`         | `tsc --noEmit`                                                                            |
| `npm run format`            | Prettier on the whole repository                                                          |
| `npm run build:icons`       | Regenerate `public/icons/*.png` from `assets/icon.svg` (needs librsvg or ImageMagick)     |
| `npm run build:screenshots` | Regenerate the README screenshots in `docs/images/` (needs Google Chrome)                 |

`build:icons` and `build:screenshots` are run by hand, and their output is
committed. The normal build and CI don't use them.

A pre-commit hook (husky) runs lint-staged (`eslint --fix` and Prettier on staged
files), then `npm run typecheck` and `npm test`.

## Project principles

These rules come before any feature:

1. **Never lose the user's Markdown.** Anything the editor can't represent must be
   kept verbatim (as a raw block or a verbatim text span) and written back
   unchanged. See
   [Markdown round-trip](docs/architecture.md#markdown-round-trip).
2. **No persistent state except the remembered save target.** The text lives only
   in the `.md` file and in the tab's memory. The one thing numenumd stores is
   which file was saved where (a file handle and its modification time, in
   IndexedDB). Don't add a second kind of stored state, not even for settings such
   as the theme. See
   [Saving and the remembered save target](docs/architecture.md#saving-and-the-remembered-save-target).
3. **No network access.** numenumd never sends or loads anything over the
   network. Everything it needs is bundled.

## Tests

- Tests use Vitest with jsdom and live next to the code as `*.test.ts` /
  `*.test.tsx`.
- For any change to parsing or serializing, add a case to the round-trip tests
  (`src/markdown/roundtrip.test.ts`), with a fixture in `tests/fixtures/` when the
  input is more than a line or two. Check that the output is stable (saving twice
  gives the same file) and that nothing is lost.
- Test real behaviour. Assert on the Markdown that comes out, not on internal
  calls.

## Manual testing

Automated tests can't load the extension in Chrome, so before a release (and for
changes to the editor UI or the save flow), check these by hand with the built
extension:

1. **Takeover**: a local `.md` opens in the editor, and the tab title is the file
   name.
2. **Other files untouched**: a local `.txt` or `.html` file keeps Chrome's normal
   view.
3. **Input rules**: `# `, `- `, `1. `, `[] `, `> `, ` ``` ` and `$$` + Enter
   create the matching blocks.
4. **Shortcuts**: bold, italic, inline code, strikethrough, link and
   `Cmd/Ctrl+Alt+1`–`6` work.
5. **Slash menu**: `/` opens it, typing filters it (including Japanese keywords
   such as `/見出し`), arrow keys and `Enter` insert, and no matches shows "No
   results".
6. **Math**: inline and block math render; `$5 and $10` stays text; clicking math
   opens the editor, `Escape` / `Cmd/Ctrl+Enter` finishes; a one-line `$$…$$`
   renders as a block and stays one line when saved; an emptied math block can be
   deleted with `Backspace`.
7. **Tables**: they render; the `+` buttons add rows and columns; grips select a
   row or column and `Backspace` deletes it; `Tab` moves between cells and adds a
   row at the end; `Shift+Enter` doesn't add a line break in a cell; `/table`
   inserts a 3×3 table; the saved file is a valid pipe table with alignment kept.
8. **Raw blocks**: a table with more cells than its header, and raw HTML, show as
   raw blocks, can be edited as text, and are saved without losing anything.
9. **Frontmatter**: shown collapsed, can be expanded and edited, and is saved byte
   for byte when only the body changes.
10. **First save and later saves**: the first `Cmd/Ctrl+S` opens the save dialog
    with the file name filled in; later saves are silent (only a toast).
11. **Remembered save target**: after reloading the tab, saving asks for
    permission instead of opening the picker; refusing permission falls back to
    the picker; a renamed or deleted file falls back to the picker; clearing from
    the "⋯" menu makes the next save open the picker again.
12. **Formatting**: the saved file is Prettier-formatted, and saving again without
    edits changes nothing.
13. **Dirty state**: `Cmd/Ctrl+S` without edits does nothing; closing a tab with
    unsaved edits shows a warning; `Cmd/Ctrl+S` works with the focus outside the
    editor.
14. **Conflicts**: if another app changes the file after a save, the next
    `Cmd/Ctrl+S` asks before overwriting; cancelling leaves the file as the other
    app wrote it; confirming overwrites it.

## Pull requests

- Branch from `main`. Don't push to `main` directly.
- Keep each PR focused on one change.
- CI runs lint, typecheck, tests and the build. All of them must pass.
- Write commit messages in English, with a conventional prefix: `feat:`, `fix:`,
  `docs:`, `test:`, `refactor:`, `chore:`, `ci:`.
- In the PR description, explain the user-visible change and how you tested it
  (including the relevant manual-testing items above).

## Releasing (maintainers)

1. Update `version` in `package.json` (and run `npm install` so
   `package-lock.json` matches), then commit.
2. Tag the commit with the same version and push the tag:

   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. The Release workflow (`.github/workflows/release.yml`) checks that the tag
   matches `package.json`, runs the tests, builds, and creates a GitHub Release
   with `numenumd-v1.2.3.zip` attached.
