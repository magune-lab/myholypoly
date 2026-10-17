import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHomeworkByDate, captureOpenHomework, captureTodayHomework, getEpolyStatus, launchEpoly, openCalendar } from './services/epoly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const appIcon = join(here, '..', 'assets', 'myholypoly.ico');
// Keep user data independent from the executable/version folder so extracted
// releases and development builds all read the same schedules and localStorage.
const persistentDataPath = join(app.getPath('appData'), 'myholypoly');
app.setPath('userData', persistentDataPath);
const planFile = () => join(app.getPath('userData'), 'plan.json');
const monthlyEventFile = () => join(app.getPath('userData'), 'monthly-events.json');
const blankPlan = { version: 1, plans: {} };
const blankMonthlyEvents = { version: 1, events: [] };
const epolyInstallGuideUrl = 'https://www.youtube.com/watch?v=g7CY3u4QoWU';
const githubRepositoryUrl = 'https://github.com/magune-lab/myholypoly';
const desktopShortcutPath = () => join(app.getPath('desktop'), 'myholypoly.lnk');
const retiredSettingsFiles = ['gemini-api-key.bin', 'ai-organizing-rules.txt'];
const polyWebLoginUrl = 'https://www.poly-english.com/member/login.do';
let polyWebWindow = null;
let mainWindow = null;
let appQuitting = false;

async function readPlan() {
  try { return JSON.parse(await readFile(planFile(), 'utf8')); }
  catch { return structuredClone(blankPlan); }
}
async function savePlan(plan) {
  await mkdir(dirname(planFile()), { recursive: true });
  await writeFile(planFile(), JSON.stringify(plan, null, 2), 'utf8');
}
async function readMonthlyEvents() {
  try {
    const value = JSON.parse(await readFile(monthlyEventFile(), 'utf8'));
    return { version: 1, events: Array.isArray(value?.events) ? value.events : [] };
  } catch { return structuredClone(blankMonthlyEvents); }
}
async function saveMonthlyEvents(value) {
  await mkdir(dirname(monthlyEventFile()), { recursive: true });
  await writeFile(monthlyEventFile(), JSON.stringify(value, null, 2), 'utf8');
}
async function removeRetiredSettings() {
  await Promise.all(retiredSettingsFiles.map(async file => {
    try { await unlink(join(app.getPath('userData'), file)); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }));
}
async function desktopShortcutExists() {
  try { await access(desktopShortcutPath()); return true; }
  catch { return false; }
}
async function setDesktopShortcut(enabled) {
  const shortcutPath = desktopShortcutPath();
  if (!enabled) {
    try { await unlink(shortcutPath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return { enabled: false };
  }
  const exists = await desktopShortcutExists();
  const shortcutIcon = app.isPackaged ? process.execPath : appIcon;
  const written = shell.writeShortcutLink(shortcutPath, exists ? 'replace' : 'create', {
    target: process.execPath,
    args: app.isPackaged ? '' : `"${projectRoot}"`,
    cwd: dirname(process.execPath),
    icon: shortcutIcon,
    iconIndex: 0,
    description: 'myholypoly 숙제 플래너',
    appUserModelId: 'com.myholypoly.desktop'
  });
  if (!written) throw new Error('바탕화면 바로가기를 만들지 못했습니다.');
  return { enabled: true };
}
function createWindow() {
  const window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 920, minHeight: 650,
    backgroundColor: '#DDF0FF', title: 'myholypoly', icon: appIcon,
    frame: false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadFile(join(here, 'renderer', 'index.html'));
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (process.platform !== 'darwin') app.quit();
  });
}

async function openPolyWeb({ activate = true } = {}) {
  if (polyWebWindow && !polyWebWindow.isDestroyed()) {
    if (activate) {
      polyWebWindow.show();
      polyWebWindow.focus();
    }
    return true;
  }
  polyWebWindow = new BrowserWindow({
    width: 1120, height: 820, minWidth: 880, minHeight: 640,
    backgroundColor: '#FFFFFF', title: 'POLY 웹 숙제', icon: appIcon,
    show: activate,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  polyWebWindow.setMenuBarVisibility(false);
  polyWebWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:www\.)?poly-english\.com\//i.test(url)) polyWebWindow.loadURL(url);
    else if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  polyWebWindow.on('close', event => {
    if (appQuitting) return;
    event.preventDefault();
    polyWebWindow.hide();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });
  polyWebWindow.on('closed', () => { polyWebWindow = null; });
  await polyWebWindow.loadURL(polyWebLoginUrl);
  if (activate) {
    polyWebWindow.show();
    polyWebWindow.focus();
  }
  return true;
}

function getPolyWebStatus() {
  if (!polyWebWindow || polyWebWindow.isDestroyed()) return { opened: false, loggedIn: false, homeworkOpen: false };
  const url = polyWebWindow.webContents.getURL();
  const loggedIn = /^https:\/\/(?:www\.)?poly-english\.com\/(?!member\/login\.do)/i.test(url);
  return { opened: true, loggedIn, homeworkOpen: /\/myPolyLife\/homework\.do/i.test(url) };
}

async function openPolyWebHomework() {
  await openPolyWeb();
  const status = getPolyWebStatus();
  if (!status.loggedIn) return { opened: false, message: 'POLY 웹에 먼저 로그인해 주세요.' };
  await polyWebWindow.loadURL('https://www.poly-english.com/myPolyLife/homework.do');
  polyWebWindow.show();
  polyWebWindow.focus();
  return { opened: true };
}

function polyWeekOfMonth(date) {
  return Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7);
}

async function capturePolyWebHomework(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))) throw new Error('과제일 형식이 올바르지 않습니다.');
  await openPolyWeb({ activate: false });
  if (!getPolyWebStatus().loggedIn) throw new Error('POLY 웹에 먼저 로그인해 주세요.');
  if (!getPolyWebStatus().homeworkOpen) await polyWebWindow.loadURL('https://www.poly-english.com/myPolyLife/homework.do');
  const memberCode = await polyWebWindow.webContents.executeJavaScript("document.querySelector('#selChild')?.value || ''", true);
  if (!memberCode) throw new Error('로그인된 자녀 정보를 찾지 못했습니다. Homework 화면을 다시 열어 주세요.');
  const date = new Date(`${dateValue}T00:00:00`);
  const query = new URLSearchParams({
    searchMemberCode: memberCode,
    searchYear: String(date.getFullYear()),
    searchMonth: String(date.getMonth() + 1),
    searchWeekCnt: String(polyWeekOfMonth(date))
  });
  await polyWebWindow.loadURL(`https://www.poly-english.com/myPolyLife/homework.do?${query}`);
  if (!getPolyWebStatus().loggedIn) throw new Error('POLY 웹 로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
  const tasks = await polyWebWindow.webContents.executeJavaScript(`(async () => {
    const selectedDate = new Date(${JSON.stringify(`${dateValue}T00:00:00`)});
    const columnIndex = selectedDate.getDay() + 1;
    const homeworkTable = document.querySelector('a.layerOpen')?.closest('table');
    const links = [...(homeworkTable?.tBodies?.[0]?.rows || [])]
      .flatMap(row => [...(row.cells[columnIndex]?.querySelectorAll('a.layerOpen') || [])]);
    const results = [];
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    for (let periodIndex = 0; periodIndex < links.length; periodIndex += 1) {
      links[periodIndex].click();
      await wait(60);
      const rows = [...document.querySelectorAll('#pop_HomewInfo tr')];
      for (const row of rows) {
        const cells = [...row.children].filter(cell => cell.tagName === 'TD');
        if (cells.length < 6 || !/^\\d+$/.test(cells[0].innerText.trim())) continue;
        const title = cells[1].innerText.trim();
        const detail = cells[2].innerText.split(/\\n+/).map(line => line.trim()).filter(Boolean).join('\\n');
        const dueText = cells[4].innerText.trim() || cells[3].innerText.trim();
        if (title) results.push({ title, detail, dueText, period: periodIndex + 1 });
      }
      document.querySelector('#pop_HomewInfo a.layerClose')?.click();
    }
    return results;
  })()`, true);
  const normalizeDueDate = text => {
    const full = String(text || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
    const short = String(text || '').match(/(\d{1,2})[./-](\d{1,2})/);
    if (short) return `${date.getFullYear()}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
    return dateValue;
  };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  return {
    tasks: tasks.map(task => ({ title: task.title, detail: task.detail, startDate: dateValue, dueDate: normalizeDueDate(task.dueText), sourcePeriod: task.period }))
  };
}

app.whenReady().then(async () => {
  await removeRetiredSettings();
  app.setAppUserModelId('com.myholypoly.desktop');
  if (app.isPackaged && await desktopShortcutExists()) {
    try { await setDesktopShortcut(true); }
    catch (error) { console.error('바탕화면 바로가기 업데이트 실패:', error); }
  }
  Menu.setApplicationMenu(null);
  ipcMain.handle('window:minimize', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.minimize();
    return true;
  });
  ipcMain.handle('window:toggle-maximize', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('app:check-update', async () => {
    try {
      const response = await fetch('https://api.github.com/repos/magune-lab/myholypoly/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'myholypoly-desktop' },
        signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) return { available: false };
      const release = await response.json();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const current = app.getVersion().split('.').map(Number);
      const latest = latestVersion.split('.').map(Number);
      const available = [0, 1, 2].some(index => (latest[index] || 0) !== (current[index] || 0) && (latest[index] || 0) > (current[index] || 0) && latest.slice(0, index).every((part, prior) => (part || 0) === (current[prior] || 0)));
      return { available, latestVersion };
    } catch { return { available: false }; }
  });
  ipcMain.handle('app:open-repository', () => shell.openExternal(githubRepositoryUrl));
  ipcMain.handle('app:desktop-shortcut-status', async () => ({ enabled: await desktopShortcutExists() }));
  ipcMain.handle('app:set-desktop-shortcut', (_event, enabled) => setDesktopShortcut(Boolean(enabled)));
  ipcMain.handle('epoly:status', () => getEpolyStatus());
  ipcMain.handle('epoly:launch', () => launchEpoly());
  ipcMain.handle('epoly:open-homework', () => captureOpenHomework());
  ipcMain.handle('epoly:today-homework', () => captureTodayHomework());
  ipcMain.handle('epoly:date-homework', (_event, date) => captureHomeworkByDate(date));
  ipcMain.handle('epoly:open-calendar', () => openCalendar());
  ipcMain.handle('epoly:open-install-guide', () => shell.openExternal(epolyInstallGuideUrl));
  ipcMain.handle('poly-web:open', () => openPolyWeb());
  ipcMain.handle('poly-web:status', () => getPolyWebStatus());
  ipcMain.handle('poly-web:open-homework', () => openPolyWebHomework());
  ipcMain.handle('poly-web:date-homework', (_event, date) => capturePolyWebHomework(date));
  ipcMain.handle('plan:read', () => readPlan());
  ipcMain.handle('monthly-events:read', () => readMonthlyEvents());
  ipcMain.handle('monthly-events:save', async (_event, draft) => {
    const title = String(draft?.title || '').trim();
    const startDate = String(draft?.startDate || draft?.date || '');
    const endDate = String(draft?.endDate || startDate);
    if (!title) throw new Error('일정 이름을 입력해 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('시작일과 종료일을 선택해 주세요.');
    if (endDate < startDate) throw new Error('종료일은 시작일보다 빠를 수 없어요.');
    const value = await readMonthlyEvents();
    const event = {
      id: String(draft?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title,
      startDate,
      endDate,
      category: ['test', 'period', 'event', 'other', 'presentation'].includes(draft?.category) ? draft.category : 'test',
      note: String(draft?.note || '').trim(),
      updatedAt: new Date().toISOString()
    };
    const index = value.events.findIndex(item => item.id === event.id);
    if (index >= 0) value.events[index] = event; else value.events.push(event);
    value.events.sort((a, b) => String(a.startDate || a.date || '').localeCompare(String(b.startDate || b.date || '')) || a.title.localeCompare(b.title, 'ko'));
    await saveMonthlyEvents(value);
    return value;
  });
  ipcMain.handle('monthly-events:delete', async (_event, id) => {
    const value = await readMonthlyEvents();
    value.events = value.events.filter(item => item.id !== String(id || ''));
    await saveMonthlyEvents(value);
    return value;
  });
  ipcMain.handle('plan:register', async (_event, draft) => {
    if (!draft?.date || !Array.isArray(draft.items)) throw new Error('등록할 일정 형식이 올바르지 않습니다.');
    const plan = await readPlan();
    const previous = plan.plans[draft.date];
    plan.plans[draft.date] = {
      date: draft.date,
      items: draft.items.map(({ title, detail, startDate = draft.date, dueDate = '', done = [], goalDates = [] }) => ({ title, detail, startDate, dueDate, done: Array.isArray(done) ? done.map(Boolean) : [], goalDates: Array.isArray(goalDates) ? goalDates.map(value => String(value || '')) : [] })),
      source: draft.source || 'manual',
      sourceChanged: Boolean(previous && previous.source !== draft.source),
      updatedAt: new Date().toISOString()
    };
    await savePlan(plan);
    return plan.plans[draft.date];
  });
  ipcMain.handle('plan:toggle-line', async (_event, { date, itemIndex, lineIndex, checked }) => {
    const plan = await readPlan();
    const item = plan.plans?.[date]?.items?.[itemIndex];
    if (!item) throw new Error('일정을 찾지 못했습니다.');
    const count = String(item.detail || '').split(/\r?\n/).filter(Boolean).length;
    item.done = Array.from({ length: count }, (_, index) => index === lineIndex ? Boolean(checked) : Boolean(item.done?.[index]));
    item.goalDates = Array.from({ length: count }, (_, index) => index === lineIndex && checked ? '' : String(item.goalDates?.[index] || ''));
    plan.plans[date].updatedAt = new Date().toISOString();
    await savePlan(plan);
    return plan;
  });
  ipcMain.handle('plan:toggle-today-goal', async (_event, { date, itemIndex, lineIndex, enabled, goalDate }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(goalDate || ''))) throw new Error('오늘 목표 날짜가 올바르지 않습니다.');
    const plan = await readPlan();
    const item = plan.plans?.[date]?.items?.[itemIndex];
    if (!item) throw new Error('일정을 찾지 못했습니다.');
    const count = String(item.detail || '').split(/\r?\n/).filter(Boolean).length;
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= count) throw new Error('할 일을 찾지 못했습니다.');
    item.goalDates = Array.from({ length: count }, (_, index) => index === lineIndex ? (enabled ? goalDate : '') : String(item.goalDates?.[index] || ''));
    plan.plans[date].updatedAt = new Date().toISOString();
    await savePlan(plan);
    return plan;
  });
  ipcMain.handle('plan:update-item', async (_event, { target, item }) => {
    if (!target?.date || !Number.isInteger(target.itemIndex) || !item?.title) throw new Error('수정할 일정 형식이 올바르지 않습니다.');
    const plan = await readPlan();
    const previous = plan.plans?.[target.date]?.items?.[target.itemIndex];
    if (!previous) throw new Error('수정할 일정을 찾지 못했습니다.');
    const lineCount = String(item.detail || '').split(/\r?\n/).filter(Boolean).length;
    plan.plans[target.date].items[target.itemIndex] = {
      title: item.title,
      detail: item.detail || '',
      startDate: item.startDate || target.date,
      dueDate: item.dueDate || '',
      done: Array.from({ length: lineCount }, (_, index) => Array.isArray(item.done) ? Boolean(item.done[index]) : Boolean(previous.done?.[index])),
      goalDates: Array.from({ length: lineCount }, (_, index) => Array.isArray(item.goalDates) ? String(item.goalDates[index] || '') : String(previous.goalDates?.[index] || ''))
    };
    plan.plans[target.date].updatedAt = new Date().toISOString();
    await savePlan(plan);
    return plan;
  });
  ipcMain.handle('plan:delete-items', async (_event, targets) => {
    if (!Array.isArray(targets) || !targets.length) throw new Error('삭제할 일정을 찾지 못했습니다.');
    const plan = await readPlan();
    const byDate = new Map();
    targets.forEach(target => {
      if (!target?.date || !Number.isInteger(target.itemIndex)) return;
      if (!byDate.has(target.date)) byDate.set(target.date, new Set());
      byDate.get(target.date).add(target.itemIndex);
    });
    byDate.forEach((indices, date) => {
      const entry = plan.plans?.[date];
      if (!entry?.items) return;
      [...indices].sort((a, b) => b - a).forEach(index => {
        if (index >= 0 && index < entry.items.length) entry.items.splice(index, 1);
      });
      if (!entry.items.length) delete plan.plans[date];
      else entry.updatedAt = new Date().toISOString();
    });
    await savePlan(plan);
    return plan;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { appQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
