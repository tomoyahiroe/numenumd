const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(md: string): {
  frontmatter: string | null;
  body: string;
} {
  const m = md.match(FM_RE);
  if (!m) return { frontmatter: null, body: md };
  return {
    frontmatter: m[1] ?? '',
    body: md.slice(m[0].length).replace(/^\r?\n/, ''),
  };
}

export function joinFrontmatter(
  frontmatter: string | null,
  body: string,
): string {
  if (frontmatter === null) return body;
  return `---\n${frontmatter}\n---\n\n${body}`;
}
