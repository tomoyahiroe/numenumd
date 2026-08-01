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

export async function mdToMd(md: string): Promise<string> {
  const serialized = serializeMarkdown(parseMarkdown(md));
  // frontmatter は verbatim 書き戻しが原則(numenumd プロジェクトルール)なので、
  // Prettier には本文だけを渡す。Prettier の markdown パーサーは YAML front
  // matter もろとも整形してしまう(例: `title:    Messy` → `title: Messy`)ため、
  // frontmatter を含めたまま渡すとユーザーの元の記述が変わってしまう。
  const { frontmatter, body } = splitFrontmatter(serialized);
  const formattedBody = await formatMarkdown(body);
  return joinFrontmatter(frontmatter, formattedBody).replace(/\n*$/, '\n');
}
