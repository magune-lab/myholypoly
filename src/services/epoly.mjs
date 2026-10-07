import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const EPOLY_PATH = 'C:\\Program Files (x86)\\KOREAPOLYSCHOOL\\e-POLY\\e-POLY.exe';
const DEBUG_PORT = 9222;
const debugUrl = `http://127.0.0.1:${DEBUG_PORT}`;
const execFileAsync = promisify(execFile);
const timeout = (promise, ms = 2500) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('e-POLY 연결 시간이 초과되었습니다.')), ms))]);

async function isEpolyRunning() {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq e-POLY.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 1800 });
    return /"e-POLY\.exe"/i.test(stdout);
  } catch { return false; }
}

async function targets() {
  const response = await timeout(fetch(`${debugUrl}/json`));
  if (!response.ok) throw new Error('e-POLY 연동 포트에 연결할 수 없습니다.');
  return response.json();
}
async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error('e-POLY 화면 응답이 없습니다.')); }, 22000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })));
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      clearTimeout(timer); socket.close();
      if (message.error || message.result?.exceptionDetails) return reject(new Error('e-POLY 화면 내용을 읽지 못했습니다.'));
      resolve(message.result?.result?.value);
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('e-POLY 연결이 끊겼습니다.')); });
  });
}

function normalizeImportedText(value) {
  return String(value || '')
    .replace(/&lt;br\s*\/?&gt;/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\(["'])/g, '$1')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeTasks(tasks = []) {
  return tasks.map(task => ({ ...task, title: normalizeImportedText(task.title), detail: normalizeImportedText(task.detail) })).filter(task => task.title && task.detail);
}

export async function getEpolyStatus() {
  const installed = existsSync(EPOLY_PATH);
  if (!installed || !(await isEpolyRunning())) return { installed, connected: false, calendarOpen: false };
  try {
    const pages = await targets();
    return { installed, connected: true, calendarOpen: pages.some(page => /Calendar/i.test(page.url || '') && !/404 Not Found/i.test(page.title || '')) };
  } catch { return { installed, connected: false, calendarOpen: false }; }
}
export async function launchEpoly() {
  if (!existsSync(EPOLY_PATH)) throw new Error('e-POLY 설치 위치를 찾을 수 없습니다.');
  spawn(EPOLY_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], { detached: true, stdio: 'ignore' }).unref();
  return { started: true };
}
export async function captureOpenHomework() {
  const pages = await targets();
  const page = pages.find(candidate => /Calendar/i.test(candidate.url || '')) || pages.find(candidate => candidate.type === 'page');
  if (!page) throw new Error('e-POLY 창을 찾지 못했습니다.');
  const result = await evaluate(page, `(() => {
    const node = document.querySelector('.homework-content');
    if (!node) return { available: false };
    const yearMonth = document.querySelector('.year')?.innerText.trim().match(/^(\\d{4})\\.(\\d{1,2})$/);
    const day = document.querySelector('.detail.schedule .day span')?.innerText.trim();
    const selectedDate = yearMonth && /^\\d{1,2}$/.test(day || '') ? [yearMonth[1], yearMonth[2].padStart(2, '0'), day.padStart(2, '0')].join('-') : null;
    const toDate = value => { const digits = String(value || '').replace(/[^0-9]/g, ''); return digits.length === 8 ? [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].join('-') : ''; };
    const tasks = [...node.querySelectorAll('tr')].map(row => {
      const subject = row.querySelector('td.subject')?.innerText.trim();
      const details = row.querySelector('td.large')?.innerText.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean) || [];
      const dueDate = row.querySelector('td.date')?.innerText.trim();
      return subject && details.length ? { title: subject, detail: details.join(String.fromCharCode(10)), dueDate: toDate(dueDate) } : null;
    }).filter(Boolean);
    return { url: location.href, available: true, selectedDate, tasks };
  })()`);
  if (!result?.available) throw new Error('숙제 목록을 연 뒤 다시 시도하세요.');
  return { ...result, tasks: normalizeTasks(result.tasks) };
}
export async function openCalendar() {
  const pages = await targets();
  const page = pages.find(candidate => candidate.type === 'page' && /portal\.koreapolyschool\.com/i.test(candidate.url || ''))
    || pages.find(candidate => candidate.type === 'page');
  if (!page) return { opened: false, message: 'e-POLY 창을 찾지 못했습니다.' };
  const result = await evaluate(page, `(() => {
    const current = new URL(location.href);
    const session = current.searchParams.get('sv');
    const isPortalPage = current.hostname === 'portal.koreapolyschool.com' && current.pathname.toLowerCase().startsWith('/front/');
    if (!session && !isPortalPage) return { opened: false, message: '로그인된 e-POLY 화면을 찾지 못했습니다.' };
    const calendar = new URL('https://portal.koreapolyschool.com/front/polyLife/Calendar.jsp');
    if (session) calendar.searchParams.set('sv', session);
    location.assign(calendar.href);
    return { opened: true };
  })()`);
  return result || { opened: false, message: '캘린더를 열지 못했습니다.' };
}

async function ensureCalendarPage() {
  let pages = await targets();
  let page = pages.find(candidate => /Calendar/i.test(candidate.url || '') && !/404 Not Found/i.test(candidate.title || ''));
  if (page) return page;
  const opened = await openCalendar();
  if (!opened?.opened) throw new Error(opened?.message || 'e-POLY 캘린더를 열지 못했습니다.');
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    pages = await targets();
    page = pages.find(candidate => /Calendar/i.test(candidate.url || '') && !/404 Not Found/i.test(candidate.title || ''));
    if (page) return page;
  }
  throw new Error('e-POLY 캘린더가 열릴 때까지 기다린 뒤 다시 시도해 주세요.');
}

export async function captureHomeworkByDate(selectedDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(selectedDate || ''))) throw new Error('가져올 날짜가 올바르지 않습니다.');
  const page = await ensureCalendarPage();
  const result = await evaluate(page, `(async () => {
    const toKey = value => String(value || '').replace(/[^0-9]/g, '').slice(0, 8);
    const toDate = value => { const digits = toKey(value); return digits.length === 8 ? [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].join('-') : ''; };
    const selectedDate = ${JSON.stringify(selectedDate)};
    const key = selectedDate.split('-').join('');
    const source = await new Promise(resolve => {
      const findSource = () => performance.getEntriesByType('resource').map(entry => entry.name).reverse().find(url => /PolyLifeCalendar\\.json/.test(url));
      const existing = findSource();
      if (existing) return resolve(existing);
      let attempts = 0;
      const timer = setInterval(() => {
        const found = findSource();
        attempts += 1;
        if (found || attempts >= 30) { clearInterval(timer); resolve(found || ''); }
      }, 250);
    });
    if (!source) return { ok: false, reason: 'calendar-not-loaded' };
    const url = new URL(source);
    const callback = '__myholypolyCalendar';
    url.searchParams.set('callback', callback);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('일정 응답 시간이 초과되었습니다.')), 9000);
      const script = document.createElement('script');
      window[callback] = payload => {
        clearTimeout(timer); delete window[callback]; script.remove();
        const rows = payload?.data?.homeworkList || [];
        const tasks = rows.filter(row => toKey(row.TIMETABLE_DATE) === key).map(row => ({
          title: row.SUBJECT || row.TITLE || 'e-POLY 숙제',
          detail: row.CONTENT || row.HomworkDetail || row.NOTE || '',
          dueDate: toDate(row.DUE_DATE || row.HOMEWORK_DUE_DATE || row.END_DATE || row.SUBMIT_DATE)
        }));
        resolve({ ok: true, date: selectedDate, tasks });
      };
      script.onerror = () => { clearTimeout(timer); delete window[callback]; script.remove(); reject(new Error('일정 요청을 불러오지 못했습니다.')); };
      script.src = url.toString(); document.head.append(script);
    });
  })()`);
  if (!result?.ok && result?.reason === 'calendar-not-loaded') throw new Error('e-POLY 캘린더 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if (!result?.ok) throw new Error('선택한 날짜의 숙제를 읽지 못했습니다.');
  return { ...result, tasks: normalizeTasks(result.tasks) };
}

export async function captureTodayHomework() {
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return captureHomeworkByDate(today);
}
