# Screenshot harness

Generates the README screenshots into `docs/images/`.

```bash
npm run build:screenshots
```

What it generates:

| File                                      | Size     | Content                                    |
| ----------------------------------------- | -------- | ------------------------------------------ |
| `docs/images/screenshot-1-math.png`       | 1280×800 | Math (KaTeX rendering)                     |
| `docs/images/screenshot-2-blocks.png`     | 1280×800 | Headings, lists, quotes, code              |
| `docs/images/screenshot-3-slash-menu.png` | 1280×800 | The slash menu, open                       |
| `docs/images/screenshot-4-preserve.png`   | 1280×800 | Preserved frontmatter, tables and raw HTML |
| `docs/images/screenshot-5-dark.png`       | 1280×800 | Dark theme                                 |

The generated PNGs are committed. The normal build (`npm run build`) and CI don't
depend on this harness at all.

## Layout

| File                      | Role                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `capture.mjs`             | Build → serve locally → capture over CDP → write `docs/images/` |
| `vite.config.ts`          | Build config for the capture page (the crx plugin removed)      |
| `index.html` / `main.tsx` | A page that mounts `src/content/App` as is                      |
| `docs/*.md`               | Sample documents to capture (switched with `?doc=<name>`)       |

## Why not capture the extension itself

numenumd is a content script for `file:///*`, so running it for real needs a
person to turn on "Allow access to file URLs" in `chrome://extensions`. Headless
Chrome can't turn that setting on (even when loaded with `--load-extension` it
stays off, and the capture shows the raw `<pre>`).

So the harness mounts the same `src/content/App` as an ordinary page and captures
that. The UI and CSS it renders are exactly the extension's.

## Why CDP

Chrome's `--screenshot` flag can't do these two things:

- **Pin the theme**: headless Chrome defaults `prefers-color-scheme` to dark, and
  the CLI can't capture light. `Emulation.setEmulatedMedia` sets it reliably.
- **Capture interactive states**: the slash menu only appears after typing `/`.
  The harness creates that state with `Input.dispatchKeyEvent` /
  `Input.dispatchMouseEvent` before capturing.

## Adding or changing a sample document

1. Add `docs/<name>.md`.
2. Register it in `DOCS` in `main.tsx`, together with the file name to display.
3. Add a capture spec to `SPECS` in `capture.mjs`.

Keys a spec can use: `name` (output file name), `path`, `theme`
(`light` / `dark`), `w` / `h`, `wait` (ms), `actions`.
Each element of `actions` is `{ clickEval }` (an expression evaluated in the page
that returns `[x, y]`), `{ key }` (a single character is typed as text; names such
as `Enter` are named keys), or `{ after }` (wait, in ms).
