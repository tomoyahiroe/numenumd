import type { JSONContent } from '@tiptap/core';
import * as prettier from 'prettier/standalone';
import * as markdownPlugin from 'prettier/plugins/markdown';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { splitFrontmatter, joinFrontmatter } from './frontmatter';

export async function formatMarkdown(md: string): Promise<string> {
  return prettier.format(md, {
    parser: 'markdown',
    plugins: [markdownPlugin],
    proseWrap: 'preserve',
  });
}

/**
 * すでにシリアライズ済みの Markdown 文字列に対し、frontmatter を Prettier から
 * 保護しつつ本文だけを整形する共通処理。`mdToMd`(文字列 in)と `docToMd`
 * (JSONContent in)の両方から呼ばれる。
 *
 * frontmatter は verbatim 書き戻しが原則(numenumd プロジェクトルール)なので、
 * Prettier には本文だけを渡す。Prettier の markdown パーサーは YAML front
 * matter もろとも整形してしまう(例: `title:    Messy` → `title: Messy`)ため、
 * frontmatter を含めたまま渡すとユーザーの元の記述が変わってしまう。
 */
async function formatPreservingFrontmatter(
  serialized: string,
): Promise<string> {
  const { frontmatter, body } = splitFrontmatter(serialized);
  const formattedBody = await formatMarkdown(body);
  return joinFrontmatter(frontmatter, formattedBody).replace(/\n*$/, '\n');
}

export async function mdToMd(md: string): Promise<string> {
  return formatPreservingFrontmatter(serializeMarkdown(parseMarkdown(md)));
}

/**
 * エディタの ProseMirror doc(JSONContent)から、frontmatter 保護つきで
 * Prettier 整形済みの Markdown 文字列を作る。App 側の保存フローはすでに
 * JSONContent を手元に持っているため、`mdToMd`(文字列 in → 内部で
 * 一度パースし直す)を使うと不要な再パースが発生してしまう。`docToMd` は
 * `serializeMarkdown` から直接始めることでその再パースを避けつつ、
 * frontmatter 保護のロジックは `mdToMd` と完全に共有する。
 */
export async function docToMd(doc: JSONContent): Promise<string> {
  return formatPreservingFrontmatter(serializeMarkdown(doc));
}
