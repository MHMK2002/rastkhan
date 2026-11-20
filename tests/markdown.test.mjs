import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');

test('Markdown code layout in Chrome', { timeout: 30000 }, async t => {
  const fixture = await readFile(new URL('markdown.html', import.meta.url));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixture);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const profile = await mkdtemp(path.join(root, '.chrome-test-'));
  const chrome = spawn(binary, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--disable-background-networking', '--user-data-dir=' + profile,
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    server.close();
    if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
      const closed = once(chrome, 'exit');
      chrome.kill();
      await closed;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await once(chrome, 'spawn');

  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  chrome.stdio[4].setEncoding('utf8').on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  const { id } = await send('Extensions.loadUnpacked', { path: process.env.EXTENSION_PATH || path.join(root, 'rastkhan') });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port }, sessionId);

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description);
    return r.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(30);
    }
    assert.fail(expression);
  }
  const settings = values => send('Extensions.setStorageItems', { id, storageArea: 'local', values }, sessionId);
  await until('document.querySelector("#paragraph")?.dataset.rastkhanDir === "rtl"');
  const source = await evaluate('listing.textContent');

  await evaluate(`
    window.direction = el => getComputedStyle(el).direction;
    window.rangeBox = (node, start, end) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      return range.getBoundingClientRect();
    };
  `);
  for (const mode of ['auto', 'rtl']) {
    await settings({ readingMode: mode });
    await until('direction(english) === ' + JSON.stringify(mode === 'rtl' ? 'rtl' : 'ltr'));
    const check = async (js, message) => assert.equal(await evaluate(js), true, mode + ' / ' + message);
    await check('direction(paragraph) === "rtl" && direction(inline) === "ltr"', 'inline code in prose');
    await check('direction(codeViewport) === "ltr" && codeViewport.scrollWidth > codeViewport.clientWidth', 'LTR scrollport');
    await check('direction(articleScroll) === "rtl" && direction(codeToolbar) === "rtl"', 'surrounding prose and toolbar');
    await check('direction(second) === "ltr" && getComputedStyle(second).textAlign === "left"', 'line alignment');
    await check('direction(anonymousScroll) === "ltr" && direction(anonymous) === "ltr" && direction(customLine) === "ltr" && direction(monoProse) === "rtl"', 'custom renderers');
    await check('!editor.hasAttribute("data-rastkhan-dir")', 'editable area');
    await check('Math.abs(rangeBox(first.firstChild.firstChild, 0, 1).left - codeViewport.getBoundingClientRect().left) < 2', 'start of overflowing line visible');
    await check('rangeBox(call.firstChild, 0, 1).left > rangeBox(first.firstChild.firstChild, 0, 1).left + 28', 'four-space indentation');
    for (const name of ['comment', 'fullComment']) {
      await check(`rangeBox(${name}.firstChild, 0, 2).right <= rangeBox(${name}.firstChild, 3, ${name}.textContent.length).left`, 'comment marker precedes Persian text');
      await check(`rangeBox(${name}.firstChild, 3, 4).left > rangeBox(${name}.firstChild, 4, 5).left`, 'Persian letters read right to left');
    }
    await check('rangeBox(call.firstChild, 0, call.textContent.length).right <= rangeBox(comment.firstChild, 0, 2).left', 'code precedes trailing comment');
    await check(`(() => {
      const text = fifth.firstChild;
      const opening = text.data.indexOf('"');
      const closing = text.data.lastIndexOf('"');
      const literal = rangeBox(text, opening + 1, closing);
      return rangeBox(text, opening, opening + 1).right <= literal.left &&
        literal.right <= rangeBox(text, closing, closing + 1).left;
    })()`, 'Persian string stays between source quotes');
    assert.equal(await evaluate('listing.textContent'), source);
  }

  await evaluate("late.classList.add('hljs')");
  await until('direction(lateLine) === "ltr" && direction(lateViewport) === "ltr"');
  await evaluate("late.insertAdjacentHTML('beforeend', '<span class=line id=stream dir=rtl>// توضیح</span>')");
  await until('direction(stream) === "ltr"');
  await evaluate("late.classList.remove('hljs')");
  await until('direction(lateLine) === "rtl" && direction(lateViewport) === "rtl"');
  await settings({ enabled: false });
  await until('!document.querySelector("[data-rastkhan-dir],[data-rastkhan-align],[data-rastkhan-active]")');
  assert.equal(await evaluate('direction(codeViewport)'), 'rtl');
  assert.equal(await evaluate('getComputedStyle(second).textAlign'), 'right');
  assert.equal(await evaluate('listing.textContent'), source);
});
