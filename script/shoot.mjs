#!/usr/bin/env node
// Drives headless Chromium over the DevTools Protocol with no dependencies —
// Node's global WebSocket (Node 22+) talks to CDP directly.
//
// Needed because --screenshot and --window-size cannot reach the states that
// matter here:
//   1. Viewports below Chromium's ~500px minimum window width, where a
//      screenshot cropped to 390px looks like a layout bug that isn't real.
//   2. Each colour scheme as a *reader* sees it. These are driven by the
//      stored preference, not by emulating prefers-color-scheme — the site
//      default is dark and the OS is deliberately not consulted, so emulating
//      the media query would only ever prove the same thing twice.
//      (--force-dark-mode is Chrome's auto-dark filter, not the media query,
//      so it never exercised our tokens in the first place.)
//
// Usage: node script/shoot.mjs <outDir>

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8765';
const OUT = resolve(process.argv[2] || '/tmp/opencode/shots');
// Random-ish high port so concurrent runs cannot collide on the CDP endpoint.
// A collision silently attaches to another browser and reports garbage.
const PORT = 9300 + Math.floor(Math.random() * 400);

mkdirSync(OUT, { recursive: true });

// name, path, width, height, theme
// `theme` is 'default' (no stored preference — exercises the site default),
// 'light', or 'dark'. The OS media query is deliberately NOT varied: the site
// default does not consult it, so varying it would only prove that twice.
const SHOTS = [
  ['home-desktop-default', '/', 1440, 900, 'default'],
  ['home-desktop-light', '/', 1440, 900, 'light'],
  ['home-desktop-dark', '/', 1440, 900, 'dark'],
  ['home-mobile-default', '/', 390, 844, 'default'],
  ['home-mobile-light', '/', 390, 844, 'light'],
  ['home-narrow', '/', 320, 800, 'default'],
  ['home-tablet', '/', 768, 1024, 'default'],
  ['rentafic-desktop', '/rentafic/', 1440, 900, 'default'],
  ['rentafic-mobile', '/rentafic/', 390, 844, 'default'],
  ['writing-mobile', '/writing/', 390, 844, 'default'],
  ['post-mobile', '/articles/2017-08/bajo-acoplamiento-en-la-construccion-de-software-ParteI.html', 390, 844, 'default'],
  ['notfound-desktop', '/404.html', 1440, 900, 'default'],
];

const chrome = spawn('chromium', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`,
  '--remote-allow-origins=*',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chromium DevTools endpoint never came up');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`${method} timed out`));
        }
      }, 30000);
    });
  }
}

const wsUrl = await targetWs();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

const cdp = new CDP(ws);
await cdp.send('Page.enable');

const report = [];

for (const [name, path, width, height, theme] of SHOTS) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 768,
  });

  // Set the stored preference, then load. 'default' means no stored value, so
  // the page renders the site default.
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(300);
  await cdp.send('Runtime.evaluate', {
    expression:
      theme === 'default'
        ? `localStorage.removeItem('theme')`
        : `localStorage.setItem('theme', ${JSON.stringify(theme)})`,
  });

  await cdp.send('Page.navigate', { url: BASE + path });
  // Wait for the document to actually finish, not a fixed sleep — a slow
  // build or a cached font can land after it and yield a half-rendered shot.
  await cdp.send('Page.loadEventFired').catch(() => {});
  await sleep(1200); // webfonts + lazy images

  // Report real layout facts alongside the screenshot.
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const de = document.documentElement;
      const vw = window.innerWidth;
      const over = [];
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (!(b.width > 0 && b.right > vw + 1)) continue;
        // Ignore anything inside a scrollable ancestor. A wide <code> inside
        // an overflow-x:auto <pre> is intentional and does not cause page
        // scroll, so it is not a defect.
        let scrollable = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') { scrollable = true; break; }
        }
        if (!scrollable) over.push(el.tagName.toLowerCase() + '.' + (el.className || ''));
      }
      return JSON.stringify({
        vw,
        scrollWidth: de.scrollWidth,
        h1: document.querySelectorAll('h1').length,
        bg: getComputedStyle(document.body).backgroundColor,
        overflow: [...new Set(over)].slice(0, 5),
      });
    })()`,
    returnByValue: true,
  });

  if (!result?.value) {
    console.log(`${name.padEnd(24)} EVAL FAILED — skipping`);
    continue;
  }

  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(data, 'base64'));

  const info = JSON.parse(result.value);
  report.push({ name, ...info });
  const flag = info.scrollWidth > info.vw + 1 || info.h1 !== 1 ? ' <-- CHECK' : '';
  console.log(
    `${name.padEnd(24)} vw=${String(info.vw).padEnd(4)} ` +
    `scrollW=${String(info.scrollWidth).padEnd(4)} ` +
    `h1=${info.h1} bg=${info.bg}${flag}` +
    (info.overflow.length ? `\n    overflow: ${info.overflow.join(', ')}` : '')
  );
}

writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
ws.close();
chrome.kill();
console.log(`\nWrote ${SHOTS.length} screenshots to ${OUT}`);
