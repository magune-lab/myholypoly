import fs from 'node:fs/promises';

const targets = await fetch('http://127.0.0.1:9333/json').then(response => response.json());
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('Electron page target not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
for (const page of ['overview', 'progress', 'register']) {
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="${page}"]').click()` });
  await new Promise(resolve => setTimeout(resolve, 300));
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(new URL(`../review-${page}.png`, import.meta.url), Buffer.from(image.data, 'base64'));
}
await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="overview"]').click(); document.querySelector('#monthPickerButton').click()` });
await new Promise(resolve => setTimeout(resolve, 200));
let image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await fs.writeFile(new URL('../review-month-picker.png', import.meta.url), Buffer.from(image.data, 'base64'));
await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="register"]').click(); document.querySelector('#planDate').click()` });
await new Promise(resolve => setTimeout(resolve, 200));
image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await fs.writeFile(new URL('../review-date-picker.png', import.meta.url), Buffer.from(image.data, 'base64'));
await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="overview"]').click(); document.querySelector('.gantt-bar')?.click()` });
await new Promise(resolve => setTimeout(resolve, 350));
image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await fs.writeFile(new URL('../review-gantt-navigation.png', import.meta.url), Buffer.from(image.data, 'base64'));
await send('Runtime.evaluate', { expression: `document.querySelector('[data-page="register"]').click(); goBack()` });
let historyCheck = await send('Runtime.evaluate', { expression: `document.querySelector('.nav-item.active')?.dataset.page`, returnByValue: true });
if (historyCheck.result.value !== 'progress') throw new Error('Back navigation did not return to progress');
await send('Runtime.evaluate', { expression: `goForward()` });
historyCheck = await send('Runtime.evaluate', { expression: `document.querySelector('.nav-item.active')?.dataset.page`, returnByValue: true });
if (historyCheck.result.value !== 'register') throw new Error('Forward navigation did not return to register');
socket.close();
