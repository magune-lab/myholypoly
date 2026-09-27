import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHomeworkByDate, captureOpenHomework, captureTodayHomework, getEpolyStatus, launchEpoly, openCalendar } from './services/epoly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appIcon = join(here, '..', 'assets', 'myholypoly.png');
// Keep user data independent from the executable/version folder so extracted
// releases and development builds all read the same schedules and localStorage.
const persistentDataPath = join(app.getPath('appData'), 'myholypoly');
app.setPath('userData', persistentDataPath);
const planFile = () => join(app.getPath('userData'), 'plan.json');
const blankPlan = { version: 1, plans: {} };
const epolyInstallGuideUrl = 'https://www.youtube.com/watch?v=g7CY3u4QoWU';

async function readPlan() {
  try { return JSON.parse(await readFile(planFile(), 'utf8')); }
  catch { return structuredClone(blankPlan); }
}
async function savePlan(plan) {
  await mkdir(dirname(planFile()), { recursive: true });
  await writeFile(planFile(), JSON.stringify(plan, null, 2), 'utf8');
}
function createWindow() {
  const window = new BrowserWindow({
    width: 1180, height: 780, minWidth: 920, minHeight: 650,
    backgroundColor: '#EFE7D3', title: 'myholypoly', icon: appIcon,
    frame: false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  window.setMenuBarVisibility(false);
  window.loadFile(join(here, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.myholypoly.desktop');
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
  ipcMain.handle('epoly:status', () => getEpolyStatus());
  ipcMain.handle('epoly:launch', () => launchEpoly());
  ipcMain.handle('epoly:open-homework', () => captureOpenHomework());
  ipcMain.handle('epoly:today-homework', () => captureTodayHomework());
  ipcMain.handle('epoly:date-homework', (_event, date) => captureHomeworkByDate(date));
  ipcMain.handle('epoly:open-calendar', () => openCalendar());
  ipcMain.handle('epoly:open-install-guide', () => shell.openExternal(epolyInstallGuideUrl));
  ipcMain.handle('plan:read', () => readPlan());
  ipcMain.handle('plan:register', async (_event, draft) => {
    if (!draft?.date || !Array.isArray(draft.items)) throw new Error('등록할 일정 형식이 올바르지 않습니다.');
    const plan = await readPlan();
    const previous = plan.plans[draft.date];
    plan.plans[draft.date] = {
      date: draft.date,
      items: draft.items.map(({ title, detail, startDate = draft.date, dueDate = '', done = [] }) => ({ title, detail, startDate, dueDate, done: Array.isArray(done) ? done.map(Boolean) : [] })),
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
      done: Array.from({ length: lineCount }, (_, index) => Array.isArray(item.done) ? Boolean(item.done[index]) : Boolean(previous.done?.[index]))
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
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
