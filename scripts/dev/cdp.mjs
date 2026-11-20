// Dev helper: drive a running app started with --remote-debugging-port=9333.
// node scripts/dev/cdp.mjs eval "<js expression>"
// node scripts/dev/cdp.mjs shot out.png
// node scripts/dev/cdp.mjs click x y [modifiers]          (mouse click at CSS px; modifiers e.g. shift,ctrl)
// node scripts/dev/cdp.mjs dblclick x y
// node scripts/dev/cdp.mjs drag x0 y0 x1 y1 [steps] [modifiers] [button]
// node scripts/dev/cdp.mjs wheel x y deltaY [modifiers]
// node scripts/dev/cdp.mjs key "Key" [modifiers]          (e.g. F5, Delete, r, z ctrl)
// node scripts/dev/cdp.mjs type "text"
// node scripts/dev/cdp.mjs dpr 1.5                        (emulate devicePixelRatio; "dpr 0" clears)
// node scripts/dev/cdp.mjs console [ms]                   (collect console/log/exceptions for ms, default 3000)
// node scripts/dev/cdp.mjs run script.mjs                 (script default-exports async (api) => {...})
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const port = process.env.CDP_PORT || 9333;
process.env.S ??= path.resolve('scripts/dev/qa/out'); // screenshot dir for QA scripts

export async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) for (const l of listeners) l(m);
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const mods = (s) => (s ? String(s).split(/[+,]/).reduce((a, k) => a | (MOD[k.trim().toLowerCase()] || 0), 0) : 0);

  const api = {
    send, sleep, ws,
    on(fn) { listeners.push(fn); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result?.result?.value;
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      return file;
    },
    async mouse(type, x, y, o = {}) {
      const button = o.button ?? 'left';
      const btnMask = { left: 1, right: 2, middle: 4, none: 0 }[button] ?? 1;
      await send('Input.dispatchMouseEvent', {
        type, x, y, button: type === 'mouseMoved' && !o.down ? 'none' : button,
        buttons: o.down ? btnMask : 0, clickCount: o.clickCount ?? (type === 'mouseMoved' ? 0 : 1), modifiers: mods(o.modifiers)
      });
    },
    async move(x, y, o = {}) { await api.mouse('mouseMoved', x, y, o); },
    async click(x, y, o = {}) {
      await api.move(x, y, o);
      await api.mouse('mousePressed', x, y, { ...o, down: true });
      await api.mouse('mouseReleased', x, y, { ...o, down: false });
    },
    async dblclick(x, y, o = {}) {
      await api.click(x, y, o);
      await api.mouse('mousePressed', x, y, { ...o, down: true, clickCount: 2 });
      await api.mouse('mouseReleased', x, y, { ...o, down: false, clickCount: 2 });
    },
    async drag(x0, y0, x1, y1, o = {}) {
      const steps = o.steps ?? 12;
      await api.move(x0, y0, o);
      await api.mouse('mousePressed', x0, y0, { ...o, down: true });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await api.mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, { ...o, down: true });
        if (o.delay) await sleep(o.delay);
      }
      await api.mouse('mouseReleased', x1, y1, { ...o, down: false });
    },
    async wheel(x, y, deltaY, o = {}) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers: mods(o.modifiers) });
    },
    async key(key, o = {}) {
      const VK = { F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F11: 122, Delete: 46, Escape: 27, Enter: 13, Tab: 9, Backspace: 8, ' ': 32, Space: 32,
        ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, '[': 219, ']': 221, '=': 187, '-': 189, '/': 191, '0': 48 };
      const single = key.length === 1;
      const k = key === 'Space' ? ' ' : key;
      const code = key === 'Space' || key === ' ' ? 'Space' : single ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : key) : key;
      const vk = VK[key] ?? (single ? key.toUpperCase().charCodeAt(0) : 0);
      const m = mods(o.modifiers);
      const text = single && !(m & 2) ? k : undefined;
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: m, text });
      if (!o.hold) await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: m });
    },
    async keyUp(key, o = {}) {
      const k = key === 'Space' ? ' ' : key;
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: key === 'Space' ? 'Space' : key, windowsVirtualKeyCode: key === 'Space' ? 32 : 0, modifiers: mods(o.modifiers) });
    },
    async type(text) { await send('Input.insertText', { text }); },
    async dpr(f) {
      if (!f) return send('Emulation.clearDeviceMetricsOverride');
      const size = await api.eval('({w: innerWidth, h: innerHeight})');
      return send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: f, mobile: false });
    },
    /** Start collecting console messages, exceptions and log entries. Returns the live array. */
    async collect() {
      const out = [];
      await send('Runtime.enable');
      await send('Log.enable');
      listeners.push((m) => {
        if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'warn', 'assert'].includes(m.params.type))
          out.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
        else if (m.method === 'Runtime.exceptionThrown')
          out.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level))
          out.push(`[log.${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
      });
      return out;
    },
    /** Bounding rect (CSS px) of the first element matching a selector. */
    async rect(sel) {
      return api.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
    },
    close() { ws.close(); }
  };
  return api;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const api = await connect();
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'eval') console.log(JSON.stringify(await api.eval(a[0]), null, 1));
    else if (cmd === 'shot') console.log('saved', await api.shot(a[0]));
    else if (cmd === 'click') { await api.click(+a[0], +a[1], { modifiers: a[2] }); console.log('clicked'); }
    else if (cmd === 'dblclick') { await api.dblclick(+a[0], +a[1]); console.log('dblclicked'); }
    else if (cmd === 'drag') { await api.drag(+a[0], +a[1], +a[2], +a[3], { steps: a[4] ? +a[4] : 12, modifiers: a[5], button: a[6] }); console.log('dragged'); }
    else if (cmd === 'wheel') { await api.wheel(+a[0], +a[1], +a[2], { modifiers: a[3] }); console.log('wheeled'); }
    else if (cmd === 'key') { await api.key(a[0], { modifiers: a[1] }); console.log('key'); }
    else if (cmd === 'type') { await api.type(a[0]); console.log('typed'); }
    else if (cmd === 'dpr') { await api.dpr(+a[0]); console.log('dpr', a[0]); }
    else if (cmd === 'console') {
      const out = await api.collect();
      await api.sleep(a[0] ? +a[0] : 3000);
      console.log(out.length ? out.join('\n') : '(no errors/warnings)');
    } else if (cmd === 'run') {
      const mod = await import(pathToFileURL(path.resolve(a[0])).href);
      const r = await mod.default(api, a.slice(1));
      if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
    } else console.log('unknown command', cmd);
  } finally {
    api.close();
  }
}
