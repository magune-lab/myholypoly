const targets = await fetch('http://127.0.0.1:9333/json').then(response => response.json());
const target = targets.find(item => item.type === 'page' && /myholypoly/i.test(item.title || '')) || targets.find(item => item.type === 'page');
if (!target) throw new Error('myholypoly renderer target not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const expression = `(() => {
  showPage('register');
  setCourses([{ title: 'English>English', dueDate: '2026-09-28', detail: 'Week 4\\ne-POLY\\nWords to Know (Pretest)\\n*Speaking Hub\\nRole-Play' }]);
  const inputs = [...document.querySelectorAll('[data-course-line="0"]')];
  inputs[0].value = 'Week 4 e-POLY Words to Know (Pretest)';
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  inputs[1].value = '';
  inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  inputs[2].value = '';
  inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-remove-line="0:1"]').click();
  return [...document.querySelectorAll('[data-course-line="0"]')].map(input => input.value);
})()`;
socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
const values = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP evaluation timed out')), 5000);
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timer);
    resolve(message.result?.result?.value);
  });
});
socket.close();
console.log(JSON.stringify(values, null, 2));
if (!values?.includes('*Speaking Hub')) throw new Error('*Speaking Hub was incorrectly deleted');
