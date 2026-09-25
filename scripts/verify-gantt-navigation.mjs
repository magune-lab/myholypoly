const targets = await fetch('http://127.0.0.1:9333/json').then(response => response.json());
const target = targets.find(item => item.type === 'page' && /myholypoly/i.test(item.title || '')) || targets.find(item => item.type === 'page');
if (!target) throw new Error('myholypoly renderer target not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const expression = `(async () => {
  showPage('overview');
  await new Promise(resolve => setTimeout(resolve, 300));
  const bar = [...document.querySelectorAll('#ganttChart .gantt-bar')].find(node => /Debate|Writing/i.test(node.textContent));
  if (!bar) return { error: 'Debate bar not found' };
  bar.click();
  await new Promise(resolve => setTimeout(resolve, 900));
  const sidebar = document.querySelector('.topbar').getBoundingClientRect();
  const page = document.querySelector('#progressPage');
  return {
    activePage: document.querySelector('.app-page.active')?.id,
    documentScrollTop: document.scrollingElement.scrollTop,
    progressScrollTop: Math.round(page.scrollTop),
    sidebarTop: Math.round(sidebar.top),
    sidebarBottom: Math.round(sidebar.bottom),
    sidebarVisible: sidebar.bottom > 0 && sidebar.top < innerHeight
  };
})()`;
socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP evaluation timed out')), 5000);
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timer);
    resolve(message.result?.result?.value);
  });
});
socket.close();
console.log(JSON.stringify(result, null, 2));
if (result.error || result.activePage !== 'progressPage' || result.documentScrollTop !== 0 || !result.sidebarVisible) process.exitCode = 1;
