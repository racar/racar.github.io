// Theme toggle verification.
//
// Checks the three-state behaviour that CSS alone cannot express:
//   1. light OS + no stored preference  -> light (the default you asked for)
//   2. dark OS  + no stored preference  -> follows the OS
//   3. explicit choice wins over the OS, in BOTH directions
//   4. no flash of the wrong theme: data-theme is set before paint
//
// Emulates prefers-color-scheme over CDP, so this exercises the real media
// query rather than a proxy. Exits non-zero on failure.

import { spawn } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://localhost:8765';
const PORT = 9700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('DevTools endpoint never came up');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve: res, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : res(m.result);
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
      }, 20000);
    });
  }
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
const cdp = new CDP(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const setScheme = (scheme) =>
  cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  });

// Read the expected colours from the stylesheet instead of hardcoding them.
// Hardcoding meant every palette change broke this suite with six failures
// that looked like theme regressions but were stale expectations.
async function expectedColors() {
  const css = await (await fetch(`${BASE}/css/main.css`)).text();
  // Brace-matched extraction of one rule's declarations. Hardcoding the
  // expected values meant every palette change broke this suite with failures
  // that looked like theme regressions but were stale expectations.
  const blockOf = (selector) => {
    const at = css.indexOf(selector);
    if (at === -1) throw new Error(`no rule for ${selector} in main.css`);
    const open = css.indexOf('{', at);
    let depth = 1;
    let j = open + 1;
    while (depth && j < css.length) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    return css.slice(open + 1, j - 1);
  };
  const hexIn = (block, name) =>
    (block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
  const toRgb = (h) => {
    if (!h) throw new Error('could not resolve a hex value');
    const v = h.replace('#', '');
    return `rgb(${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)})`;
  };
  // The bare :root rule is the DEFAULT, which is now dark.
  const def = blockOf(':root{');
  const light = blockOf(":root[data-theme=light]{");
  const dark = blockOf(":root[data-theme=dark]{");
  return {
    lightBg: toRgb(hexIn(light, '--bg-0')),
    lightRaw: hexIn(light, '--bg-0'),
    darkBg: toRgb(hexIn(dark, '--bg-0')),
    darkRaw: hexIn(dark, '--bg-0'),
    defaultMatchesDark: hexIn(def, '--bg-0') === hexIn(dark, '--bg-0'),
  };
}

const C = await expectedColors();
console.log(`expecting light ${C.lightBg} / dark ${C.darkBg}`);
if (!C.defaultMatchesDark) {
  console.log('x :root default does not equal :root[data-theme=dark]');
  process.exit(1);
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function load(path = '/') {
  await cdp.send('Page.navigate', { url: BASE + path });
  await sleep(900);
}

const failures = [];
const check = (name, actual, expected) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${actual}`);
  if (!ok) failures.push(`${name}: got ${actual}, want ${expected}`);
};

console.log('\nTHEME TOGGLE');
console.log('='.repeat(70));
console.log('dark is the DEFAULT; light is opt-in via the toggle.');
console.log('The OS preference is deliberately not consulted.\n');

// Helper: read the effective --bg-0 the page is actually rendering.
async function rendered() {
  return evaluate(`getComputedStyle(document.body).backgroundColor`);
}

// ── 1. default is dark, with no stored preference and a LIGHT OS ────────
// This is the case that matters: if the default only applied to people whose
// OS already agreed with it, it would not be a default.
await setScheme('light');
await load();
await evaluate(`localStorage.removeItem('theme')`);
await load();
let s = await evaluate(`(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
  pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'),
  label: document.querySelector('[data-theme-toggle]').getAttribute('aria-label'),
  sun: getComputedStyle(document.querySelector('.theme-toggle__sun')).display,
  moon: getComputedStyle(document.querySelector('.theme-toggle__moon')).display,
}))()`);
console.log('\n1. light OS, no stored preference -> must still be DARK');
check('renders dark', s.bg, C.darkBg);
check('no data-theme attribute (using the default)', s.attr, null);
check('aria-pressed', s.pressed, 'true');
check('label names the action', s.label, 'Switch to light theme');
check('sun hidden', s.sun, 'none');
check('moon shown', s.moon, 'block');

// ── 2. clicking switches to light and persists ─────────────────────────
console.log('\n2. click the toggle');
await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
await sleep(150);
s = await evaluate(`(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
  stored: localStorage.getItem('theme'),
  pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'),
  label: document.querySelector('[data-theme-toggle]').getAttribute('aria-label'),
  sun: getComputedStyle(document.querySelector('.theme-toggle__sun')).display,
}))()`);
check('data-theme=light', s.attr, 'light');
check('renders light', s.bg, C.lightBg);
check('persisted to localStorage', s.stored, 'light');
check('aria-pressed', s.pressed, 'false');
check('label flips', s.label, 'Switch to dark theme');
check('sun icon now shown', s.sun, 'block');

// ── 3. persistence across navigation ───────────────────────────────────
console.log('\n3. navigate to /rentafic/ — light must survive');
await load('/rentafic/');
s = await evaluate(`(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
}))()`);
check('still light after navigation', s.attr, 'light');
check('no flash — light on arrival', s.bg, C.lightBg);

// ── 4. explicit choice is never overridden by the OS ───────────────────
console.log('\n4. stored "light", then the OS flips to dark');
await setScheme('dark');
await load();
s = await evaluate(`(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
}))()`);
check('data-theme=light', s.attr, 'light');
check('explicit light survives an OS change', s.bg, C.lightBg);

// ── 5. clearing the preference returns to the dark default ─────────────
console.log('\n5. clear the stored preference');
await evaluate(`localStorage.removeItem('theme')`);
await load();
s = await evaluate(`(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
}))()`);
check('no attribute', s.attr, null);
check('falls back to the dark default', s.bg, C.darkBg);

// ── 6. OS changes must NOT move the theme ──────────────────────────────
console.log('\n6. OS switches light -> dark with no stored preference');
await setScheme('light');
await evaluate(`localStorage.removeItem('theme')`);
await load();
const before = await rendered();
await setScheme('dark');
await sleep(200);
const after = await rendered();
check('theme ignores the OS (before)', before, C.darkBg);
check('theme ignores the OS (after)', after, C.darkBg);

// ── 7. no script at all ────────────────────────────────────────────────
console.log('\n7. JavaScript disabled');
await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
await load();
check('still renders the dark default', await rendered(), C.darkBg);
await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });

// ── 8. stored light + reload: no flash of the wrong theme ──────────────
console.log('\n8. stored light + reload (no-flash check)');
await setScheme('dark');
await evaluate(`localStorage.setItem('theme', 'light')`);
await cdp.send('Page.navigate', { url: BASE + '/' });
await cdp.send('Page.loadEventFired').catch(() => {});
const firstPaint = await evaluate(
  `getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim()`
);
check('--bg-0 is the light value on arrival', firstPaint, C.lightRaw);

// ── 9. back to dark, persisted ─────────────────────────────────────────
console.log('\n9. toggle back to dark and reload');
await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
await cdp.send('Page.navigate', { url: BASE + '/' });
await cdp.send('Page.loadEventFired').catch(() => {});
s = await evaluate(`(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
  pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'),
}))()`);
check('persisted dark', s.attr, 'dark');
check('renders dark after reload', s.bg, C.darkBg);
check('aria-pressed', s.pressed, 'true');

ws.close();
chrome.kill();

console.log('\n' + '='.repeat(70));
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log('  x ' + f);
  process.exit(1);
}
console.log('All theme-toggle checks pass.');
