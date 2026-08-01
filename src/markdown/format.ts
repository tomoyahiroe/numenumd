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
