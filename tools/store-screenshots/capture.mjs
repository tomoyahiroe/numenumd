#!/usr/bin/env node
/**
 * Chrome ウェブストア掲載用の画像を docs/store-assets/ に生成する。
 *
 *   npm run build:store-assets
 *
 * 手順は「ハーネスをビルド → ローカルで配信 → headless Chrome(CDP)で撮影」。
 *
 * なぜ拡張機能そのものを撮らないのか:
 * numenumd は `file:///*` の content script なので、実際に動かすには
 * chrome://extensions の「ファイルの URL へのアクセスを許可する」を人間が手で
 * ON にする必要があり、headless Chrome では有効化できない。そこで同じ
 * src/content/App を普通のページとしてマウントしたハーネスを撮る。描画される
 * UI・CSS は拡張機能とまったく同じものになる。
 *
 * なぜ CDP なのか(`--screenshot` ではなく):
 *  - headless Chrome の prefers-color-scheme 既定は dark で、CLI からは light を
 *    撮れない。Emulation.setEmulatedMedia なら light/dark を確実に指定できる。
 *  - スラッシュメニューのような対話状態を Input.* で作ってから撮影できる。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT_DIR = resolve(ROOT, 'docs/store-assets');
const BUILD_DIR = resolve(HERE, 'out');
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.SHOT_PORT ?? 8899);
const DEBUG_PORT = Number(process.env.SHOT_DEBUG_PORT ?? 9333);

// ウェブストアのスクリーンショットは 1280x800 か 640x400 のみ。小さいプロモ
// タイルは 440x280。ここから外れるとアップロード時に弾かれる。
const SHOT = { w: 1280, h: 800 };

/** 最後のリスト項目の行末をクリックする式(空段落は座標を決め打ちできない)。 */
const CLICK_LAST_LIST_ITEM =
  "(()=>{const li=[...document.querySelectorAll('.ProseMirror li')].pop();" +
  'const r=li.getBoundingClientRect();' +
  'return [Math.round(r.right-30),Math.round(r.y+r.height/2)];})()';

const SPECS = [
  {
    name: 'screenshot-1-math',
    path: `/index.html?doc=math`,
    theme: 'light',
    ...SHOT,
  },
  {
    name: 'screenshot-2-blocks',
    path: `/index.html?doc=blocks`,
    theme: 'light',
    ...SHOT,
  },
  {
    name: 'screenshot-3-slash-menu',
    path: `/index.html?doc=slash`,
    theme: 'light',
    ...SHOT,
    actions: [
      { clickEval: CLICK_LAST_LIST_ITEM, after: 600 },
      { key: 'End', after: 200 },
      { key: 'Enter', after: 600 },
      { key: '/', after: 1500 },
    ],
  },
  {
    name: 'screenshot-4-preserve',
    path: `/index.html?doc=preserve`,
    theme: 'light',
    ...SHOT,
  },
  {
    name: 'screenshot-5-dark',
    path: `/index.html?doc=math`,
    theme: 'dark',
    ...SHOT,
  },
  {
    name: 'promo-small-tile',
    path: '/promo.html',
    theme: 'light',
    w: 440,
    h: 280,
    wait: 1200,
  },
];

const KEY_CODES = { Enter: 13, End: 35, Home: 36, ArrowDown: 40, Escape: 27 };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CDP の JSON-RPC を WebSocket 上でやりとりする最小クライアント。 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

async function serve() {
  const server = createServer(async (req, res) => {
    const file = resolve(BUILD_DIR, '.' + req.url.split('?')[0]);
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(PORT, r));
  return server;
}

async function launchChrome() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${resolve(HERE, '.chrome-profile')}`,
  ]);
  chrome.stderr.on('data', () => {});

  for (let i = 0; i < 60; i++) {
    try {
      const v = await (
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      ).json();
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
      });
      return { chrome, cdp: new Cdp(ws) };
    } catch {
      await sleep(300);
    }
  }
  chrome.kill();
  throw new Error(`Chrome の DevTools に接続できませんでした (${CHROME})`);
}

async function capture(cdp, spec) {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const call = (m, p) => cdp.send(m, p, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: spec.w,
    height: spec.h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: spec.theme }],
  });
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}${spec.path}` });
  await sleep(spec.wait ?? 2500);

  for (const action of spec.actions ?? []) {
    if (action.clickEval) {
      const { result } = await call('Runtime.evaluate', {
        expression: action.clickEval,
        returnByValue: true,
      });
      const [x, y] = result.value;
      for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
      }
    }
    if (action.key) {
      // 1文字は文字入力、それ以外(Enter / End など)は名前付きキーとして送る。
      const named = action.key.length > 1;
      const code = KEY_CODES[action.key] ?? 0;
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: action.key,
        text: named ? (action.key === 'Enter' ? '\r' : undefined) : action.key,
        windowsVirtualKeyCode: named ? code : 0,
        nativeVirtualKeyCode: named ? code : 0,
      });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: action.key });
    }
    await sleep(action.after ?? 500);
  }

  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    resolve(OUT_DIR, `${spec.name}.png`),
    Buffer.from(data, 'base64'),
  );
  await cdp.send('Target.closeTarget', { targetId });
  console.log(
    `generated docs/store-assets/${spec.name}.png (${spec.w}x${spec.h}, ${spec.theme})`,
  );
}

async function main() {
  const build = spawnSync(
    'npx',
    ['vite', 'build', '--config', 'tools/store-screenshots/vite.config.ts'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);

  await mkdir(OUT_DIR, { recursive: true });
  const server = await serve();
  const { chrome, cdp } = await launchChrome();
  try {
    for (const spec of SPECS) await capture(cdp, spec);
  } finally {
    chrome.kill();
    server.close();
    await rm(BUILD_DIR, { recursive: true, force: true });
    await rm(resolve(HERE, '.chrome-profile'), {
      recursive: true,
      force: true,
    });
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
