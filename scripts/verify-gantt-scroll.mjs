const targets = await fetch('http://127.0.0.1:9333/json').then(response => response.json());
const target = targets.find(item => item.type === 'page' && /myholypoly/i.test(item.title || '')) || targets.find(item => item.type === 'page');
if (!target) throw new Error('myholypoly renderer target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const expression = `(async () => {
  const host = document.querySelector('#ganttChart');
  const results = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    showPage('progress');
    host.scrollLeft = 0;
    showPage('overview');
    await new Promise(resolve => setTimeout(resolve, 120));
    results.push({
      attempt: attempt + 1,
      scrollLeft: host.scrollLeft,
      maxScrollLeft: host.scrollWidth - host.clientWidth,
      atEnd: host.scrollLeft === host.scrollWidth - host.clientWidth
    });
  }
  return { month: document.querySelector('#ganttMonth').value, results };
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
if (!result?.results?.every(item => item.atEnd)) process.exitCode = 1;
