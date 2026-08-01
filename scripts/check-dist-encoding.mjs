// Chrome (Chromium's base::IsStringUTF8) rejects content scripts containing
// Unicode noncharacters (U+FFFE/U+FFFF, U+FDD0–U+FDEF, U+nFFFE/U+nFFFF) or
// surrogate byte sequences, even though they are valid UTF-8 per RFC 3629.
// This script fails the build if any dist JS would be refused by Chrome.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* jsFiles(p);
    else if (name.endsWith('.js')) yield p;
  }
}

const BAD_PATTERNS = [
  ['UTF-16 surrogate (WTF-8)', /\xed[\xa0-\xbf][\x80-\xbf]/],
  ['noncharacter U+FDD0-U+FDEF', /\xef\xb7[\x90-\xaf]/],
  ['noncharacter U+FFFE/U+FFFF', /\xef\xbf[\xbe\xbf]/],
  ['plane-end noncharacter U+nFFFE/U+nFFFF', /[\xf0-\xf4][\x80-\xbf]\xbf[\xbe\xbf]/],
];

let failures = 0;
for (const file of jsFiles(DIST)) {
  const bytes = readFileSync(file, 'latin1');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
  } catch {
    console.error(`INVALID UTF-8: ${file}`);
    failures++;
    continue;
  }
  for (const [label, re] of BAD_PATTERNS) {
    const m = bytes.match(re);
    if (m) {
      console.error(`CHROME-REJECTED (${label}): ${file} at byte ${m.index}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) would be rejected by Chrome's content script loader.`);
  process.exit(1);
}
console.log('dist encoding OK: all JS files pass Chrome content-script validation');
