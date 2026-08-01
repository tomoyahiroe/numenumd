# numenumd MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `file:///…/*.md` を開くと Notion 風 WYSIWYG エディタに置き換わり、Cmd+S で Prettier 整形済み Markdown を元ファイルに上書き保存する Chrome 拡張(MV3)を、pre-commit / CI / CD(スキップ可)ハーネス付きで構築する。

**Architecture:** コンテンツスクリプトが Chrome の `<pre>` 表示から生 Markdown を取得し、ページ DOM に React + Tiptap エディタを直接マウント。保存は File System Access API(初回のみピッカー)。Markdown⇄エディタ変換は markdown-it + prosemirror-markdown による純関数層で、ゴールデン/冪等性テストで品質を固定する。

**Tech Stack:** TypeScript / Vite / @crxjs/vite-plugin / React 18 / Tiptap v2 / markdown-it / prosemirror-markdown / KaTeX / Prettier(standalone) / Vitest / ESLint / husky + lint-staged / GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-01-numenumd-design.md`

## Global Constraints

- Manifest V3。永続状態(IndexedDB / localStorage / chrome.storage)を一切持たない。状態はタブのメモリ内のみ。
- ユーザーの Markdown を絶対に失わない: 変換できない記法(テーブル・生 HTML 等)は「生 Markdown ブロック」として無傷で往復させる。
- YAML フロントマターは編集せず verbatim で往復。
- 保存整形は Prettier(markdown parser)。箇条書きは `-`、見出しは ATX(`#`)。
- dirty でなければ Cmd+S は何もしない(開いただけのファイルに差分を作らない)。
- 文字コードは UTF-8 前提。
- コミットは Conventional Commits(`feat:` / `fix:` / `test:` / `chore:` / `docs:` / `ci:`)。
- 各コミット前に pre-commit フックが lint / format / typecheck / 全テストを強制する(Task 1 以降)。
- パッケージマネージャは npm。

## File Structure(最終形)

```
numenumd/
├── manifest.config.ts          # MV3 マニフェスト(CRXJS defineManifest)
├── vite.config.ts / tsconfig.json / eslint.config.js / .prettierrc.json
├── .husky/pre-commit
├── .github/workflows/ci.yml    # PR CI(lint/typecheck/test/build)
├── .github/workflows/release.yml  # タグ→CWS デプロイ(Secrets 無ければスキップ)
├── CLAUDE.md                   # プロジェクトルール(独立レビューゲート等)
├── src/
│   ├── content/main.tsx        # ① エントリ: .md 判定→<pre>抽出→マウント
│   ├── content/App.tsx         # ① エディタ+保存+通知を束ねるルート
│   ├── editor/extensions.ts    # ② Tiptap 拡張一式(スキーマ)
│   ├── editor/nodes/math-block.ts / raw-block.ts / frontmatter.ts  # ② カスタムノード
│   ├── editor/Editor.tsx       # ② React エディタコンポーネント
│   ├── editor/editor.css       # ② Notion 風スタイル
│   ├── editor/slash/items.ts   # ② スラッシュメニュー項目とフィルタ(純関数)
│   ├── editor/slash/suggestion.tsx  # ② @tiptap/suggestion 設定+メニュー UI
│   ├── keymap/router.ts        # ③ KeyRouter(純粋・vim の将来の差し込み口)
│   ├── keymap/extension.ts     # ③ Tiptap 拡張として handleKeyDown を一元横取り
│   ├── markdown/parse.ts       # ④ md → ProseMirror doc JSON
│   ├── markdown/serialize.ts   # ④ doc JSON → md
│   ├── markdown/format.ts      # ④ Prettier 整形
│   ├── markdown/frontmatter.ts # ④ フロントマター strip/reattach
│   └── file/controller.ts      # ⑤ FileController(FS Access API)
├── tests/fixtures/*.md         # ゴールデンテスト入力
└── docs/smoke-checklist.md     # 手動 E2E チェックリスト
```

---

### Task 1: プロジェクト scaffolding + pre-commit ハーネス

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`, `manifest.config.ts`, `.husky/pre-commit`, `src/sanity.test.ts`

**Interfaces:**
- Consumes: なし(最初のタスク)
- Produces: `npm run dev|build|test|lint|typecheck|format` スクリプト。以降の全タスクはこの上で作業する。

- [ ] **Step 1: npm プロジェクト初期化と依存インストール**

```bash
npm init -y
npm i react@^18 react-dom@^18 @tiptap/core@^2 @tiptap/react@^2 @tiptap/starter-kit@^2 \
  @tiptap/extension-task-list@^2 @tiptap/extension-task-item@^2 @tiptap/extension-link@^2 \
  @tiptap/extension-mathematics@^2 @tiptap/suggestion@^2 katex markdown-it prosemirror-markdown \
  prosemirror-model prosemirror-state prosemirror-view prettier tippy.js
npm i -D typescript vite @crxjs/vite-plugin@beta @vitejs/plugin-react vitest jsdom \
  @types/react @types/react-dom @types/markdown-it @types/katex \
  eslint @eslint/js typescript-eslint eslint-config-prettier husky lint-staged
```

- [ ] **Step 2: 設定ファイル群を作成**

`package.json` に追記:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write ."
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{css,md,json,yml}": ["prettier --write"]
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  test: { environment: 'jsdom' },
});
```

(`test` キーの型エラーが出る場合は `/// <reference types="vitest/config" />` を先頭に追加)

`manifest.config.ts`(内容は Task 10 で本格化。ビルドが通る最小形):

```ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'numenumd',
  version: '0.1.0',
  description: 'Notion-like WYSIWYG editor for local Markdown files',
  content_scripts: [
    {
      matches: ['file:///*'],
      include_globs: ['*.md'],
      js: ['src/content/main.tsx'],
      run_at: 'document_idle',
    },
  ],
});
```

`src/content/main.tsx`(この時点ではプレースホルダではなく最小実体):

```tsx
console.log('numenumd loaded');
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "manifest.config.ts", "vite.config.ts"]
}
```

`eslint.config.js`(flat config):

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { ignores: ['dist/**'] }
);
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "proseWrap": "preserve" }
```

`.gitignore`: `node_modules/`, `dist/`, `*.local`

- [ ] **Step 3: sanity テストを書き、fail→pass を確認**

`src/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test` → PASS、`npm run lint` → エラー 0、`npm run typecheck` → エラー 0、`npm run build` → `dist/` 生成、を全部確認。

- [ ] **Step 4: husky pre-commit を設定**

```bash
npx husky init
```

`.husky/pre-commit` の内容を以下に置き換え:

```bash
npx lint-staged
npm run typecheck
npm test
```

- [ ] **Step 5: コミット(pre-commit が走ることを確認)**

```bash
git add -A
git commit -m "chore: scaffold vite+crxjs+react+tiptap project with pre-commit harness"
```

Expected: コミット時に lint-staged / typecheck / vitest が実行されてから成功する。

---

### Task 2: GitHub リポジトリ + CI/CD ワークフロー + CLAUDE.md

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1 の npm scripts(`lint` / `typecheck` / `test` / `build`)
- Produces: GitHub リモート、PR 時 CI、タグ時 CD(Secrets 無ければスキップ)、独立レビューゲート規約

- [ ] **Step 1: GitHub リポジトリ作成と push**

```bash
gh repo create numenumd --private --source=. --push
```

`gh` 未認証で失敗した場合: このステップをスキップした旨をユーザーに報告し、以降のステップ(ファイル作成)は続行する。

- [ ] **Step 2: CI ワークフローを作成**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: extension-dist, path: dist/ }
```

- [ ] **Step 3: リリース(CD)ワークフローを作成**

`.github/workflows/release.yml`(Secrets 未設定なら publish ジョブが自動スキップ):

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - name: Verify tag matches manifest version
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          VER=$(node -p "require('./package.json').version")
          test "$TAG" = "$VER" || { echo "tag $TAG != package version $VER"; exit 1; }
      - run: npm test
      - run: npm run build
      - run: cd dist && zip -r ../extension.zip .
      - uses: actions/upload-artifact@v4
        with: { name: extension-zip, path: extension.zip }
  publish:
    needs: build
    runs-on: ubuntu-latest
    env:
      CWS_CLIENT_ID: ${{ secrets.CWS_CLIENT_ID }}
    steps:
      - name: Skip if secrets not configured
        if: env.CWS_CLIENT_ID == ''
        run: echo "CWS secrets not set — skipping publish" && exit 0
      - uses: actions/download-artifact@v4
        if: env.CWS_CLIENT_ID != ''
        with: { name: extension-zip }
      - name: Upload & publish to Chrome Web Store
        if: env.CWS_CLIENT_ID != ''
        run: |
          npx chrome-webstore-upload-cli@3 upload --source extension.zip --auto-publish \
            --extension-id "${{ secrets.CWS_EXTENSION_ID }}" \
            --client-id "${{ secrets.CWS_CLIENT_ID }}" \
            --client-secret "${{ secrets.CWS_CLIENT_SECRET }}" \
            --refresh-token "${{ secrets.CWS_REFRESH_TOKEN }}"
```

- [ ] **Step 4: CLAUDE.md(プロジェクトルール)を作成**

`CLAUDE.md`:

```markdown
# numenumd プロジェクトルール

## コマンド
- テスト: `npm test` / lint: `npm run lint` / 型: `npm run typecheck` / ビルド: `npm run build`

## マージゲート(必須)
PR をマージする前に、必ず**このセッションの文脈を共有しない新規 subagent** に
レビューさせること。subagent には以下を依頼する:
1. PR ブランチを checkout し `npm test && npm run lint && npm run typecheck && npm run build` を実行
2. spec(docs/superpowers/specs/)・plan(docs/superpowers/plans/)との整合を確認
3. テストの実在性(アサーションが本当に仕様を検証しているか)と diff 品質をレビュー
マージ条件は **CI グリーン + この独立レビューの承認** の両方。承認後に `gh pr merge`。

## 原則
- ユーザーの Markdown を絶対に失わない(変換不能記法は rawBlock で往復)
- 永続状態を持たない(状態は .md ファイルとタブのメモリのみ)
- main へ直接 push しない
```

- [ ] **Step 5: ブランチ保護を設定しコミット**

```bash
git add -A
git commit -m "ci: add PR CI, tag-triggered CWS release (skips without secrets), project rules"
git push -u origin main 2>/dev/null || true
gh api -X PUT "repos/{owner}/numenumd/branches/main/protection" \
  -F 'required_status_checks[strict]=true' -F 'required_status_checks[contexts][]=checks' \
  -F 'enforce_admins=false' -F 'required_pull_request_reviews=null' -F 'restrictions=null' \
  2>/dev/null || echo "branch protection skipped (no remote/auth)"
```

Expected: リモートがあれば push と保護設定が成功。無ければローカルコミットのみで続行。

---

### Task 3: エディタスキーマ(Tiptap 拡張一式 + カスタムノード)

**Files:**
- Create: `src/editor/extensions.ts`, `src/editor/nodes/math-block.ts`, `src/editor/nodes/raw-block.ts`, `src/editor/nodes/frontmatter.ts`
- Test: `src/editor/extensions.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `buildExtensions(): Extensions`(@tiptap/core の `Extensions` 型)。ノード名は正確に `doc, paragraph, heading, bulletList, orderedList, listItem, taskList, taskItem, blockquote, codeBlock, mathBlock, rawBlock, frontmatter, text` / マーク `bold, italic, strike, code, link`。`mathBlock` 属性 `latex: string`、`rawBlock` 属性 `content: string`、`frontmatter` 属性 `content: string`(`---` 区切りを除いた中身)。Task 4/5/7 はこのスキーマに依存する。

- [ ] **Step 1: 失敗するテストを書く**

`src/editor/extensions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildExtensions } from './extensions';

const makeEditor = () => new Editor({ extensions: buildExtensions() });

describe('buildExtensions', () => {
  it('registers all node and mark types', () => {
    const editor = makeEditor();
    const { nodes, marks } = editor.schema;
    for (const n of ['heading', 'bulletList', 'taskList', 'taskItem', 'codeBlock',
                     'mathBlock', 'rawBlock', 'frontmatter']) {
      expect(nodes[n], `node ${n}`).toBeDefined();
    }
    for (const m of ['bold', 'italic', 'strike', 'code', 'link']) {
      expect(marks[m], `mark ${m}`).toBeDefined();
    }
  });

  it('mathBlock holds latex as attribute', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'mathBlock', attrs: { latex: 'E = mc^2' } }],
    });
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: 'E = mc^2' },
    });
  });

  it('rawBlock round-trips arbitrary text via attrs', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'rawBlock', attrs: { content: '| a | b |\n|---|---|' } }],
    });
    expect(editor.getJSON().content?.[0]?.attrs?.content).toBe('| a | b |\n|---|---|');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/editor/extensions.test.ts`
Expected: FAIL(`buildExtensions` が存在しない)

- [ ] **Step 3: 実装**

`src/editor/nodes/math-block.ts`(atom ノード。NodeView での KaTeX 描画は Task 7 で接続するため、ここでは schema 定義のみ):

```ts
import { Node, mergeAttributes } from '@tiptap/core';

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { latex: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' }), node.attrs.latex];
  },
});
```

`src/editor/nodes/raw-block.ts` も同型(name: `rawBlock`, 属性 `content`, tag: `div[data-raw-block]`)。`src/editor/nodes/frontmatter.ts` も同型(name: `frontmatter`, 属性 `content`, tag: `div[data-frontmatter]`)。3 ファイルとも上のコードの name / 属性名 / data 属性だけ差し替えた同構造で作る。

`src/editor/extensions.ts`:

```ts
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
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/editor/extensions.test.ts`
Expected: PASS(jsdom 環境で Editor 生成に失敗する場合、テストファイル先頭に `// @vitest-environment jsdom` を付ける)

- [ ] **Step 5: コミット**

```bash
git add src/editor
git commit -m "feat: tiptap schema with mathBlock/rawBlock/frontmatter custom nodes"
```

---

### Task 4: Markdown パース(md → ProseMirror doc JSON)

**Files:**
- Create: `src/markdown/frontmatter.ts`, `src/markdown/parse.ts`
- Test: `src/markdown/parse.test.ts`

**Interfaces:**
- Consumes: Task 3 の `buildExtensions()`(スキーマ取得用)とノード名・属性名
- Produces: `parseMarkdown(md: string): JSONContent`(@tiptap/core の doc JSON)/ `splitFrontmatter(md: string): { frontmatter: string | null; body: string }` と `joinFrontmatter(frontmatter: string | null, body: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/markdown/parse.test.ts`(要点抜粋 — 全ケースを実装すること):

```ts
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parse';
import { splitFrontmatter } from './frontmatter';

const types = (md: string) => (parseMarkdown(md).content ?? []).map((n) => n.type);

describe('parseMarkdown', () => {
  it('parses headings, lists, quote, code', () => {
    expect(types('# h1\n\n- a\n\n> q\n\n```js\nx\n```')).toEqual([
      'heading', 'bulletList', 'blockquote', 'codeBlock',
    ]);
  });

  it('parses task list items with checked state', () => {
    const doc = parseMarkdown('- [x] done\n- [ ] todo');
    const list = doc.content?.[0];
    expect(list?.type).toBe('taskList');
    expect(list?.content?.[0]?.attrs?.checked).toBe(true);
    expect(list?.content?.[1]?.attrs?.checked).toBe(false);
  });

  it('parses inline marks and links', () => {
    const para = parseMarkdown('**b** *i* ~~s~~ `c` [t](https://x.jp)').content?.[0];
    const marks = para?.content?.flatMap((t) => t.marks?.map((m) => m.type) ?? []);
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'strike', 'code', 'link']));
  });

  it('turns $$ blocks into mathBlock nodes', () => {
    const doc = parseMarkdown('$$\n\\int_0^1 x dx\n$$');
    expect(doc.content?.[0]).toMatchObject({
      type: 'mathBlock',
      attrs: { latex: '\\int_0^1 x dx' },
    });
  });

  it('keeps inline math as plain text', () => {
    const para = parseMarkdown('when $E=mc^2$ holds').content?.[0];
    expect(para?.content?.map((t) => t.text).join('')).toBe('when $E=mc^2$ holds');
  });

  it('preserves tables as rawBlock verbatim', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const doc = parseMarkdown(src);
    expect(doc.content?.[0]?.type).toBe('rawBlock');
    expect(doc.content?.[0]?.attrs?.content).toBe(src);
  });

  it('preserves html blocks as rawBlock verbatim', () => {
    const doc = parseMarkdown('<div class="x">\nhi\n</div>');
    expect(doc.content?.[0]?.type).toBe('rawBlock');
  });

  it('extracts frontmatter into a frontmatter node at doc head', () => {
    const doc = parseMarkdown('---\ntitle: hi\n---\n\n# body');
    expect(doc.content?.[0]).toMatchObject({
      type: 'frontmatter',
      attrs: { content: 'title: hi' },
    });
    expect(doc.content?.[1]?.type).toBe('heading');
  });
});

describe('splitFrontmatter', () => {
  it('splits only a leading --- block', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({ frontmatter: 'a: 1', body: 'body' });
    expect(splitFrontmatter('body\n---\nx\n---')).toEqual({ frontmatter: null, body: 'body\n---\nx\n---' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/markdown/parse.test.ts`
Expected: FAIL(モジュール未定義)

- [ ] **Step 3: 実装**

`src/markdown/frontmatter.ts`:

```ts
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const m = md.match(FM_RE);
  if (!m) return { frontmatter: null, body: md };
  return { frontmatter: m[1] ?? '', body: md.slice(m[0].length).replace(/^\r?\n/, '') };
}

export function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (frontmatter === null) return body;
  return `---\n${frontmatter}\n---\n\n${body}`;
}
```

`src/markdown/parse.ts` の実装方針(この構造で実装する):

1. `getSchema(buildExtensions())`(@tiptap/core)で ProseMirror スキーマを得る。
2. `markdown-it`(`{ html: true }`)インスタンスに以下のカスタムを施す:
   - **ブロック数式ルール**: 行頭 `$$` から次の `$$` 行までを `math_block` トークン(content = 中身、`token.markup='$$'`)にするブロックルールを `md.block.ruler.before('fence', 'math_block', ...)` で追加。
   - **テーブル/HTML の rawBlock 化**: `md.core.ruler.push` で後処理し、`table_open`〜`table_close` のトークン列を 1 個の `raw_block` トークンに置換。元テキストは `token.map`(行範囲)から `state.src` の該当行スライスで復元して content に入れる。`html_block` トークンも同様に `raw_block` へ改名。
3. `prosemirror-markdown` の `MarkdownParser(schema, md, tokens)` を、スキーマのノード名に合わせたトークンマップで構成する:
   - `bullet_list→bulletList` `ordered_list→orderedList` `list_item→listItem` `heading→heading(attrs: level)` `blockquote→blockquote` `fence/code_block→codeBlock(attrs: language)` `paragraph→paragraph` `math_block→{node:'mathBlock', getAttrs: t=>({latex: t.content.trim()})}` `raw_block→{node:'rawBlock', getAttrs: t=>({content: t.content})}` マークは `strong→bold` `em→italic` `s→strike` `code_inline→code` `link→link(attrs: href)`
   - `mathBlock` / `rawBlock` は atom ノードなので `MarkdownParser` のトークンマップでは `noCloseToken: true` 扱いの node として登録する。
   - **タスクリスト**: markdown-it 標準では `- [x]` はただのテキスト。core ruler の後処理で、`list_item_open` 直後の paragraph 先頭が `[x] ` / `[ ] ` のものを検出してトークンに `checked` 属性を仕込み、リスト全体を `taskList` / `taskItem` にマップする。テキスト先頭の `[x] ` は除去する。
4. `parseMarkdown` は `splitFrontmatter` → 本文をパース → frontmatter があれば doc.content 先頭に `{type:'frontmatter', attrs:{content}}` を差し込み、`doc.toJSON()` を返す。

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/markdown/parse.test.ts`
Expected: 全ケース PASS

- [ ] **Step 5: コミット**

```bash
git add src/markdown
git commit -m "feat: markdown→prosemirror parser with math/table/html/frontmatter preservation"
```

---

### Task 5: Markdown シリアライズ + Prettier 整形 + ゴールデン/冪等性テスト

**Files:**
- Create: `src/markdown/serialize.ts`, `src/markdown/format.ts`, `tests/fixtures/basic.md`, `tests/fixtures/blocks.md`, `tests/fixtures/math.md`, `tests/fixtures/edge.md`
- Test: `src/markdown/roundtrip.test.ts`

**Interfaces:**
- Consumes: Task 3 のスキーマ、Task 4 の `parseMarkdown` / `joinFrontmatter`
- Produces: `serializeMarkdown(doc: JSONContent): string`(frontmatter ノードを先頭 `---` ブロックに戻すところまで含む)/ `formatMarkdown(md: string): Promise<string>`(Prettier 整形)/ `mdToMd(md: string): Promise<string>`(parse→serialize→format の合成。FileController と content 層はこれだけ使う)

- [ ] **Step 1: フィクスチャと失敗するテストを書く**

`tests/fixtures/basic.md`(見出し/リスト/インラインマーク/リンク/引用/コード)、`blocks.md`(タスクリスト/ネストリスト/テーブル/HTML ブロック)、`math.md`(インライン数式/ブロック数式/frontmatter 付き)、`edge.md`(空ファイル/`*` 箇条書きや `##` 直後スペース無しなど整形対象の乱れた記法)を実データで作成する。

`src/markdown/roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { mdToMd } from './format';

const dir = join(__dirname, '../../tests/fixtures');

describe('serialize', () => {
  it('serializes basic blocks back to markdown', () => {
    const md = '# h1\n\n- a\n- b\n\n> quote\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes taskList back as - [x] / - [ ]', () => {
    const md = '- [x] done\n- [ ] todo\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes mathBlock back as $$ fenced block', () => {
    const md = '$$\nE = mc^2\n$$\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('writes rawBlock content verbatim', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('restores frontmatter at head', () => {
    const md = '---\ntitle: t\n---\n\n# h\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });
});

describe('mdToMd (golden + idempotency)', () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    it(`round-trips ${f} losslessly after one format`, async () => {
      const src = readFileSync(join(dir, f), 'utf8');
      const once = await mdToMd(src);
      const twice = await mdToMd(once);
      expect(twice).toBe(once); // 冪等: 2回保存しても差分ゼロ
    });
  }

  it('normalizes bullets to - and headings to ATX', async () => {
    expect(await mdToMd('* item\n')).toBe('- item\n');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/markdown/roundtrip.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/markdown/serialize.ts` — `prosemirror-markdown` の `MarkdownSerializer` を自前ノード対応で構成する:

```ts
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { getSchema, type JSONContent } from '@tiptap/core';
import { Node as PMNode } from 'prosemirror-model';
import { buildExtensions } from '../editor/extensions';
import { joinFrontmatter } from './frontmatter';

const schema = getSchema(buildExtensions());
const d = defaultMarkdownSerializer;

const serializer = new MarkdownSerializer(
  {
    paragraph: d.nodes.paragraph!,
    heading: d.nodes.heading!,
    blockquote: d.nodes.blockquote!,
    codeBlock: d.nodes.code_block!,
    bulletList: (state, node) => state.renderList(node, '  ', () => '- '),
    orderedList: d.nodes.ordered_list!,
    listItem: d.nodes.list_item!,
    taskList: (state, node) => state.renderList(node, '  ', () => '- '),
    taskItem: (state, node) => {
      state.write(node.attrs.checked ? '[x] ' : '[ ] ');
      state.renderContent(node);
    },
    mathBlock: (state, node) => {
      state.write('$$\n');
      state.text(node.attrs.latex, false);
      state.ensureNewLine();
      state.write('$$');
      state.closeBlock(node);
    },
    rawBlock: (state, node) => {
      state.text(node.attrs.content, false);
      state.closeBlock(node);
    },
    frontmatter: (state, node) => state.closeBlock(node), // 本文には出さない(下で合成)
    text: d.nodes.text!,
    hardBreak: d.nodes.hard_break!,
    horizontalRule: d.nodes.horizontal_rule!,
  },
  {
    bold: d.marks.strong!,
    italic: d.marks.em!,
    code: d.marks.code!,
    link: d.marks.link!,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  }
);

export function serializeMarkdown(docJson: JSONContent): string {
  const doc = PMNode.fromJSON(schema, docJson);
  const fmNode = docJson.content?.find((n) => n.type === 'frontmatter');
  const body = serializer.serialize(doc);
  return joinFrontmatter(fmNode ? String(fmNode.attrs?.content ?? '') : null, body).replace(/\n*$/, '\n');
}
```

(注: `defaultMarkdownSerializer` のキー名が実物と違う場合は `prosemirror-markdown` の型定義を確認して合わせる。taskItem の renderContent で先頭 paragraph がインライン化されるよう、listItem と同じ `state.renderInline` ベースの書き方に調整してよい。テストが正。)

`src/markdown/format.ts`:

```ts
import * as prettier from 'prettier/standalone';
import * as markdownPlugin from 'prettier/plugins/markdown';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';

export async function formatMarkdown(md: string): Promise<string> {
  return prettier.format(md, {
    parser: 'markdown',
    plugins: [markdownPlugin],
    proseWrap: 'preserve',
  });
}

export async function mdToMd(md: string): Promise<string> {
  return formatMarkdown(serializeMarkdown(parseMarkdown(md)));
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npm test`
Expected: 全 PASS(冪等性テスト含む)。失敗したフィクスチャは serializer/parser のどちらの責任か切り分けて直す。

- [ ] **Step 5: コミット**

```bash
git add src/markdown tests/fixtures
git commit -m "feat: prosemirror→markdown serializer with prettier formatting and golden idempotency tests"
```

---

### Task 6: KeyRouter(キー入力一元インターセプト層)

**Files:**
- Create: `src/keymap/router.ts`, `src/keymap/extension.ts`
- Test: `src/keymap/router.test.ts`

**Interfaces:**
- Consumes: なし(純粋モジュール)
- Produces: `KeyRouter` クラス — `register(priority: number, handler: KeyHandler): () => void`(戻り値は解除関数)/ `route(ev: KeyboardEvent): boolean`(true = 消費済み)。`type KeyHandler = (ev: KeyboardEvent) => boolean`。および `KeymapExtension(router: KeyRouter)` — ProseMirror の `handleKeyDown` 最優先プラグインとして router に委譲する Tiptap 拡張ファクトリ。Phase 2 の vim はここに `register` するだけで差し込める。

- [ ] **Step 1: 失敗するテストを書く**

`src/keymap/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { KeyRouter } from './router';

const ev = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent('keydown', { key, ...mods });

describe('KeyRouter', () => {
  it('routes to handlers in priority order (lower number first)', () => {
    const r = new KeyRouter();
    const calls: string[] = [];
    r.register(10, () => (calls.push('low'), false));
    r.register(1, () => (calls.push('high'), false));
    r.route(ev('a'));
    expect(calls).toEqual(['high', 'low']);
  });

  it('stops at the first handler that consumes the event', () => {
    const r = new KeyRouter();
    const calls: string[] = [];
    r.register(1, () => (calls.push('first'), true));
    r.register(2, () => (calls.push('second'), false));
    expect(r.route(ev('a'))).toBe(true);
    expect(calls).toEqual(['first']);
  });

  it('returns false when no handler consumes', () => {
    expect(new KeyRouter().route(ev('a'))).toBe(false);
  });

  it('unregister removes the handler', () => {
    const r = new KeyRouter();
    const off = r.register(1, () => true);
    off();
    expect(r.route(ev('a'))).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/keymap/router.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/keymap/router.ts`:

```ts
export type KeyHandler = (ev: KeyboardEvent) => boolean;

export class KeyRouter {
  private handlers: { priority: number; handler: KeyHandler }[] = [];

  register(priority: number, handler: KeyHandler): () => void {
    const entry = { priority, handler };
    this.handlers.push(entry);
    this.handlers.sort((a, b) => a.priority - b.priority);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== entry);
    };
  }

  route(ev: KeyboardEvent): boolean {
    for (const { handler } of this.handlers) {
      if (handler(ev)) return true;
    }
    return false;
  }
}
```

`src/keymap/extension.ts`:

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { KeyRouter } from './router';

export function KeymapExtension(router: KeyRouter) {
  return Extension.create({
    name: 'numenumdKeymap',
    priority: 10000, // 最優先で他拡張より先に handleKeyDown を受ける
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('numenumdKeyRouter'),
          props: {
            handleKeyDown: (_view, ev) => router.route(ev),
          },
        }),
      ];
    },
  });
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/keymap/router.test.ts` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/keymap
git commit -m "feat: KeyRouter central key interception layer (vim insertion point)"
```

---

### Task 7: エディタ React コンポーネント(UI + ショートカット + NodeView)

**Files:**
- Create: `src/editor/Editor.tsx`, `src/editor/editor.css`
- Modify: `src/editor/nodes/math-block.ts`(NodeView 追加), `src/editor/nodes/raw-block.ts`(同), `src/editor/nodes/frontmatter.ts`(同)
- Test: `src/editor/Editor.test.tsx`

**Interfaces:**
- Consumes: Task 3 `buildExtensions`、Task 6 `KeyRouter` / `KeymapExtension`
- Produces: `<MarkdownEditor initialDoc={JSONContent} router={KeyRouter} onDocChange={(doc: JSONContent) => void} />`(named export `MarkdownEditor`)。`onDocChange` は編集のたびに最新 doc JSON を返す(dirty 判定は呼び出し側 = Task 9)。

- [ ] **Step 1: 失敗するテストを書く**

`src/editor/Editor.test.tsx`(`// @vitest-environment jsdom`):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownEditor } from './Editor';
import { KeyRouter } from '../keymap/router';
import { parseMarkdown } from '../markdown/parse';

describe('MarkdownEditor', () => {
  it('renders initial markdown content', async () => {
    render(
      <MarkdownEditor initialDoc={parseMarkdown('# Hello')} router={new KeyRouter()} onDocChange={() => {}} />
    );
    expect(await screen.findByText('Hello')).toBeTruthy();
  });

  it('calls onDocChange when content changes', async () => {
    const onDocChange = vi.fn();
    render(
      <MarkdownEditor initialDoc={parseMarkdown('x')} router={new KeyRouter()} onDocChange={onDocChange} />
    );
    // Tiptap の editor インスタンス経由で変更を発火(テスト用に data-testid で editor を掴む)
    // 実装では useEditor の onUpdate から onDocChange(editor.getJSON()) を呼ぶ
  });
});
```

(2 本目は実装後に editor インスタンスを `window.__numenumdEditor__`(dev/test 限定で公開)経由で `editor.commands.insertContent('y')` を実行して `onDocChange` 呼び出しを検証する形で完成させる。`@testing-library/react` を devDependencies に追加: `npm i -D @testing-library/react`)

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/editor/Editor.test.tsx` → FAIL

- [ ] **Step 3: 実装**

`src/editor/Editor.tsx`:

```tsx
import { useEditor, EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { useEffect } from 'react';
import { buildExtensions } from './extensions';
import { KeymapExtension } from '../keymap/extension';
import type { KeyRouter } from '../keymap/router';
import './editor.css';

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
      (window as any).__numenumdEditor__ = editor;
    }
  }, [editor]);
  return <EditorContent editor={editor} className="numenumd-editor" />;
}
```

NodeView 追加(各カスタムノードに `addNodeView`):

- `math-block.ts`: KaTeX で `latex` を `katex.render(node.attrs.latex, dom, { displayMode: true, throwOnError: false })` 描画。クリックで `<textarea>` に切替えて編集、blur / Cmd+Enter で `updateAttributes({ latex })` して再レンダリング。
- `raw-block.ts`: `<pre class="numenumd-raw">` に `content` をそのまま表示。クリックで `<textarea>` 編集、blur で反映。
- `frontmatter.ts`: `<details class="numenumd-frontmatter"><summary>Front matter</summary><pre>…</pre></details>`。中の `<pre>` はクリックで `<textarea>` 編集。

ショートカットについて: `Cmd+B/I/E/Shift+X/K/Alt+1..3` は StarterKit / Link 拡張の標準キーマップで既に効く(`Cmd+E` はインラインコードの Tiptap 標準)。`Cmd+K` のリンクは `Link` 拡張にキーマップが無いので、`buildExtensions` 側に `addKeyboardShortcuts` で `Mod-k: () => 選択範囲に window.prompt('URL') の値で setLink`(空入力なら unsetLink)する小さな Extension を追加する。`Cmd+S` は Task 9 で KeyRouter に登録する(エディタ側では扱わない)。

入力オートフォーマット: `# ` `- ` `1. ` `> ` ` ``` ` は StarterKit、`[] ` は TaskItem 標準(`- [ ]` 形式)に加えて、行頭 `[] `→taskList にする `textblockTypeInputRule` を TaskList 側に追加。`$$` + Enter/Space → mathBlock 挿入の `nodeInputRule` を MathBlock に追加。

`src/editor/editor.css`(Notion 風の要点):

```css
.numenumd-editor { max-width: 720px; margin: 0 auto; padding: 96px 24px 30vh; }
.numenumd-editor .ProseMirror { outline: none; font: 16px/1.7 -apple-system, 'Hiragino Sans', sans-serif; color: #37352f; }
.numenumd-editor h1 { font-size: 2em; font-weight: 700; margin: 1em 0 0.3em; }
.numenumd-editor h2 { font-size: 1.5em; font-weight: 600; margin: 1em 0 0.3em; }
.numenumd-editor h3 { font-size: 1.25em; font-weight: 600; }
.numenumd-editor code { background: rgba(135,131,120,0.15); border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.85em; color: #eb5757; }
.numenumd-editor pre { background: #f7f6f3; border-radius: 4px; padding: 16px; overflow-x: auto; }
.numenumd-editor pre code { background: none; color: inherit; }
.numenumd-editor blockquote { border-left: 3px solid #37352f; margin: 0; padding-left: 14px; }
.numenumd-editor ul[data-type='taskList'] { list-style: none; padding-left: 0; }
.numenumd-raw { background: #fffbe6; border: 1px dashed #d9c58a; padding: 12px; }
.numenumd-frontmatter { color: #787774; font-size: 0.85em; }
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/editor` → PASS。`npm run build` も通ること。

- [ ] **Step 5: コミット**

```bash
git add src/editor package.json package-lock.json
git commit -m "feat: react editor component with notion-like styles, nodeviews, shortcuts"
```

---

### Task 8: スラッシュコマンド

**Files:**
- Create: `src/editor/slash/items.ts`, `src/editor/slash/suggestion.tsx`
- Modify: `src/editor/extensions.ts`(suggestion 拡張を追加)
- Test: `src/editor/slash/items.test.ts`

**Interfaces:**
- Consumes: Task 3 のスキーマ(コマンドは Tiptap の `editor.chain()` を使用)
- Produces: `SLASH_ITEMS: SlashItem[]` と `filterSlashItems(query: string): SlashItem[]`。`type SlashItem = { title: string; keywords: string[]; command: (editor: Editor, range: Range) => void }`。extensions.ts に組み込まれるため上位層の変更は不要。

- [ ] **Step 1: 失敗するテストを書く**

`src/editor/slash/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SLASH_ITEMS, filterSlashItems } from './items';

describe('slash items', () => {
  it('includes all MVP block types', () => {
    const titles = SLASH_ITEMS.map((i) => i.title);
    for (const t of ['Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list',
                     'Numbered list', 'To-do list', 'Quote', 'Code block', 'Math block']) {
      expect(titles).toContain(t);
    }
  });

  it('filters by title prefix and keywords, case-insensitive', () => {
    expect(filterSlashItems('head').length).toBe(3);
    expect(filterSlashItems('HEAD').length).toBe(3);
    expect(filterSlashItems('todo').map((i) => i.title)).toEqual(['To-do list']);
    expect(filterSlashItems('数式').map((i) => i.title)).toEqual(['Math block']);
  });

  it('returns all items for empty query', () => {
    expect(filterSlashItems('')).toEqual(SLASH_ITEMS);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/editor/slash/items.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/editor/slash/items.ts`: 各 item の `command` は `editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()` 等(To-do は `toggleTaskList`、Math は `insertContent({ type: 'mathBlock', attrs: { latex: '' } })`)。`keywords` に日本語(`見出し`, `箇条書き`, `番号`, `チェック`, `todo`, `引用`, `コード`, `数式`)を含める。`filterSlashItems` は `title.toLowerCase().includes(q)` または `keywords.some(k => k.toLowerCase().includes(q))`。

`src/editor/slash/suggestion.tsx`: `@tiptap/suggestion` を使う Extension。`char: '/'`、`items: ({ query }) => filterSlashItems(query)`、`render` は tippy.js でカーソル位置にポップアップし、React でメニュー(`SlashMenu`)を描画。`ArrowUp/Down` で選択移動、`Enter` で `command` 実行、`Escape` で閉じる。Tiptap 公式 suggestion のリファレンス実装と同じ構造で書く。

`extensions.ts` の `buildExtensions()` 戻り値に追加。

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/editor/slash` → PASS。`npm run build` も通ること。

- [ ] **Step 5: コミット**

```bash
git add src/editor
git commit -m "feat: notion-style slash command menu"
```

---

### Task 9: FileController(File System Access API 保存管理)

**Files:**
- Create: `src/file/controller.ts`
- Test: `src/file/controller.test.ts`

**Interfaces:**
- Consumes: なし(ブラウザ API のみ。markdown 変換は呼び出し側が済ませて文字列を渡す)
- Produces: `class FileController` — `constructor(suggestedName: string)` / `async save(markdown: string): Promise<SaveResult>` / `async confirmOverwrite(markdown: string): Promise<SaveResult>`(conflict 後の強制上書き)。`type SaveResult = 'saved' | 'cancelled' | 'conflict'`。ピッカーは初回 save のみ。保存成功時に内部で mtime を記録し、次回 save 時に外部変更を検知したら `'conflict'` を返す(書き込まない)。

- [ ] **Step 1: 失敗するテストを書く**

`src/file/controller.test.ts`(`showSaveFilePicker` をモック):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileController } from './controller';

function mockHandle(initialMtime: number) {
  let mtime = initialMtime;
  const written: string[] = [];
  const handle = {
    getFile: vi.fn(async () => ({ lastModified: mtime })),
    createWritable: vi.fn(async () => ({
      write: vi.fn(async (data: string) => { written.push(data); mtime += 1; }),
      close: vi.fn(async () => {}),
    })),
  };
  return { handle, written, bumpMtime: () => { mtime += 100; } };
}

describe('FileController', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('opens picker on first save, then saves silently', async () => {
    const { handle, written } = mockHandle(1000);
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const fc = new FileController('note.md');
    expect(await fc.save('# a\n')).toBe('saved');
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'note.md' })
    );
    expect(await fc.save('# b\n')).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['# a\n', '# b\n']);
  });

  it('returns cancelled when user dismisses picker', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => {
      throw new DOMException('user cancelled', 'AbortError');
    }));
    expect(await new FileController('n.md').save('x')).toBe('cancelled');
  });

  it('detects external modification and refuses to overwrite', async () => {
    const { handle, bumpMtime, written } = mockHandle(1000);
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    const fc = new FileController('n.md');
    await fc.save('v1');
    bumpMtime(); // 他アプリがファイルを変更
    expect(await fc.save('v2')).toBe('conflict');
    expect(written).toEqual(['v1']);
    expect(await fc.confirmOverwrite('v2')).toBe('saved');
    expect(written).toEqual(['v1', 'v2']);
  });

  it('re-prompts picker when permission was revoked', async () => {
    const { handle } = mockHandle(1000);
    const fresh = mockHandle(2000);
    handle.createWritable = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    const fc = new FileController('n.md');
    await fc.save('v1'); // 初回: handle 取得後 write で NotAllowedError
    picker.mockImplementation(async () => fresh.handle);
    expect(await fc.save('v1')).toBe('saved'); // 再ピッカーで復帰
    expect(picker).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/file` → FAIL

- [ ] **Step 3: 実装**

`src/file/controller.ts`:

```ts
export type SaveResult = 'saved' | 'cancelled' | 'conflict';

export class FileController {
  private handle: FileSystemFileHandle | null = null;
  private lastSavedMtime: number | null = null;

  constructor(private suggestedName: string) {}

  async save(markdown: string): Promise<SaveResult> {
    if (!this.handle) {
      try {
        this.handle = await window.showSaveFilePicker({
          suggestedName: this.suggestedName,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
        throw e;
      }
    } else if (this.lastSavedMtime !== null) {
      const file = await this.handle.getFile();
      if (file.lastModified > this.lastSavedMtime) return 'conflict';
    }
    return this.write(markdown);
  }

  async confirmOverwrite(markdown: string): Promise<SaveResult> {
    return this.write(markdown);
  }

  private async write(markdown: string): Promise<SaveResult> {
    if (!this.handle) return this.save(markdown);
    try {
      const w = await this.handle.createWritable();
      await w.write(markdown);
      await w.close();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        this.handle = null; // 権限失効 → 次回 save で再ピッカー
        this.lastSavedMtime = null;
        return 'cancelled';
      }
      throw e;
    }
    this.lastSavedMtime = (await this.handle.getFile()).lastModified;
    return 'saved';
  }
}
```

(注: `window.showSaveFilePicker` の型は `tsconfig` の lib に無ければ `src/file/fs-access.d.ts` に最小宣言を書く。テスト 4 本目「権限失効→再ピッカー」は上記実装だと 1 回目が 'cancelled' で返る仕様なので、テスト側の期待値をこの仕様(`'cancelled'` → 次回 save で picker 再表示)に合わせて調整する。テストが仕様の正とする。)

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/file` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/file
git commit -m "feat: FileController with FS Access API, conflict detection, permission recovery"
```

---

### Task 10: コンテンツスクリプト統合(App + manifest 本格化)

**Files:**
- Create: `src/content/App.tsx`
- Modify: `src/content/main.tsx`(実体化), `manifest.config.ts`(名称・アイコン整備)
- Test: `src/content/App.test.tsx`

**Interfaces:**
- Consumes: Task 4 `parseMarkdown`、Task 5 `serializeMarkdown` / `formatMarkdown`、Task 6 `KeyRouter`、Task 7 `MarkdownEditor`、Task 9 `FileController`
- Produces: 動作する拡張機能(`npm run build` → `dist/` を chrome://extensions で読み込める)

- [ ] **Step 1: 失敗するテストを書く**

`src/content/App.test.tsx`(`// @vitest-environment jsdom`):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('../file/controller', () => ({
  FileController: vi.fn(() => ({ save: vi.fn(async () => 'saved') })),
}));

describe('App', () => {
  it('renders editor from raw markdown and shows filename', async () => {
    render(<App rawMarkdown={'# Title'} filename="note.md" />);
    expect(await screen.findByText('Title')).toBeTruthy();
    expect(screen.getByText('note.md')).toBeTruthy();
  });

  it('shows dirty indicator after edit and clears after save', async () => {
    render(<App rawMarkdown={'x'} filename="note.md" />);
    expect(screen.queryByTestId('dirty-dot')).toBeNull();
    // 編集(テスト用グローバル editor 経由)→ dirty 表示
    (window as any).__numenumdEditor__.commands.insertContent('y');
    expect(await screen.findByTestId('dirty-dot')).toBeTruthy();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/content` → FAIL

- [ ] **Step 3: 実装**

`src/content/App.tsx`:

```tsx
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { JSONContent } from '@tiptap/core';
import { parseMarkdown } from '../markdown/parse';
import { serializeMarkdown } from '../markdown/serialize';
import { formatMarkdown } from '../markdown/format';
import { MarkdownEditor } from '../editor/Editor';
import { KeyRouter } from '../keymap/router';
import { FileController } from '../file/controller';

type Props = { rawMarkdown: string; filename: string };

export function App({ rawMarkdown, filename }: Props) {
  const initialDoc = useMemo(() => parseMarkdown(rawMarkdown), [rawMarkdown]);
  const router = useMemo(() => new KeyRouter(), []);
  const fc = useMemo(() => new FileController(filename), [filename]);
  const docRef = useRef<JSONContent>(initialDoc);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!dirty) return;
    const md = await formatMarkdown(serializeMarkdown(docRef.current));
    let result = await fc.save(md);
    if (result === 'conflict') {
      if (confirm('ファイルが他のアプリで変更されています。上書きしますか?')) {
        result = await fc.confirmOverwrite(md);
      } else return;
    }
    if (result === 'saved') { setDirty(false); setToast('保存しました'); }
    if (result === 'cancelled') setToast('保存をキャンセルしました');
    setTimeout(() => setToast(null), 2000);
  }, [dirty, fc]);

  useEffect(() =>
    router.register(100, (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
        ev.preventDefault();
        void save();
        return true;
      }
      return false;
    }), [router, save]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    document.title = (dirty ? '● ' : '') + filename;
  }, [dirty, filename]);

  return (
    <div className="numenumd-app">
      <header className="numenumd-header">
        <span>{filename}</span>
        {dirty && <span data-testid="dirty-dot" className="numenumd-dirty">●</span>}
      </header>
      <MarkdownEditor
        initialDoc={initialDoc}
        router={router}
        onDocChange={(doc) => { docRef.current = doc; setDirty(true); }}
      />
      {toast && <div className="numenumd-toast">{toast}</div>}
    </div>
  );
}
```

(ヘッダ・トーストの CSS を `editor.css` に追加: header は上部固定・小さめグレー文字、toast は右下フェード。)

`src/content/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

function boot() {
  if (!location.pathname.toLowerCase().endsWith('.md')) return;
  const pre = document.body.querySelector('pre');
  const rawMarkdown = pre?.textContent ?? '';
  const filename = decodeURIComponent(location.pathname.split('/').pop() ?? 'untitled.md');
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  const root = document.createElement('div');
  root.id = 'numenumd-root';
  document.body.appendChild(root);
  createRoot(root).render(<App rawMarkdown={rawMarkdown} filename={filename} />);
}

boot();
```

`manifest.config.ts` は Task 1 の内容のままで動くはず。`run_at: 'document_idle'` を維持(`<pre>` 生成後に走る必要がある)。

- [ ] **Step 4: テスト+ビルド+実機確認**

Run: `npm test` → 全 PASS、`npm run build` → 成功。
実機: `chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択 → 拡張の詳細で「ファイルの URL へのアクセスを許可する」を ON → 適当な `.md` を `Cmd+O` で開く → エディタが表示され、編集→`Cmd+S`→ピッカー→保存、を確認。

- [ ] **Step 5: コミット**

```bash
git add src/content src/editor manifest.config.ts
git commit -m "feat: content script integration — file:// takeover, save flow, dirty indicator"
```

---

### Task 11: 手動スモークチェックリスト + README

**Files:**
- Create: `docs/smoke-checklist.md`, `README.md`

**Interfaces:**
- Consumes: 完成した拡張(Task 10)
- Produces: リリース前手動確認手順と、セットアップドキュメント

- [ ] **Step 1: スモークチェックリストを書く**

`docs/smoke-checklist.md` — 以下の 12 項目を再現手順付きで記載する:

1. 拡張読み込み+file URL アクセス許可で `.md` がエディタ表示になる
2. `.md` 以外の file:// ページは乗っ取らない
3. `# ` `- ` `1. ` `[] ` `> ` ``` ``` ``` `$$` の入力オートフォーマットが効く
4. `Cmd+B/I/E/Shift+X/K/Alt+1..3` が効く
5. `/` メニューが出る・絞り込める・Enter で挿入される
6. インライン `$…$` とブロック `$$…$$` が KaTeX レンダリングされ、クリック編集できる
7. テーブル入り md が生ブロック表示され、保存しても壊れない
8. frontmatter 入り md が折りたたみ表示され、保存後も verbatim
9. 初回 `Cmd+S` でピッカー(ファイル名プリセット済み)→ 2 回目以降は無音保存
10. 保存された md が Prettier 整形済みで、再保存しても差分ゼロ(冪等)
11. 未編集のまま `Cmd+S` → 何も起きない。未保存でタブを閉じる → 警告
12. エディタ表示中に他アプリでファイル変更 → `Cmd+S` で競合警告

- [ ] **Step 2: README を書く**

`README.md`: プロジェクト概要(1 段落)、開発コマンド、インストール手順(dist 読み込み+「ファイルの URL へのアクセスを許可する」の設定方法をスクリーンショット位置込みで)、リリース手順(バージョン更新→タグ push→CD。CWS Secrets 設定手順へのポインタとして spec の該当節を参照)。

- [ ] **Step 3: スモークチェックを実際に実行**

`docs/smoke-checklist.md` の全項目を実機で実施し、結果(✅/❌)を記録。❌ があれば修正してから次へ。

- [ ] **Step 4: コミット**

```bash
git add docs/smoke-checklist.md README.md
git commit -m "docs: smoke checklist and README"
```

---

## Self-Review 結果(計画作成時に実施済み)

- **Spec coverage:** アーキテクチャ(T10)、スキーマ/機能(T3,7,8)、Markdown 変換+整形(T4,5)、KeyRouter(T6)、FileController+エラー処理(T9,10)、テスト戦略(各タスク+T5 ゴールデン/冪等+T11 手動)、ハーネス(T1,2)— スペック全節にタスクあり。Phase 2/3 はスコープ外(スペック通り)。
- **Type consistency:** ノード名(`mathBlock`/`rawBlock`/`frontmatter`)、`SaveResult`、`KeyRouter.register/route`、`MarkdownEditor` props、`mdToMd` の参照名は全タスク間で一致確認済み。
- **既知の不確実点(実装時にテストを正として調整可):** `@crxjs/vite-plugin` beta の設定細部、`@tiptap/extension-mathematics` v2 の設定 API、`defaultMarkdownSerializer` のキー名、jsdom 上の Tiptap 挙動。いずれも該当タスク内で完結し、他タスクへの波及はない。
