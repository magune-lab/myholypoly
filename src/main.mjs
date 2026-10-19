import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureHomeworkByDate, captureOpenHomework, captureTodayHomework, getEpolyStatus, launchEpoly, openCalendar } from './services/epoly.mjs';
import { readJsonFile } from './services/json-storage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const appIcon = join(here, '..', 'assets', 'myholypoly.ico');
// Keep user data independent from the executable/version folder so extracted
// releases and development builds all read the same schedules and localStorage.
const persistentDataPath = process.env.MYHOLYPOLY_DATA_PATH || join(app.getPath('appData'), 'myholypoly');
app.setPath('userData', persistentDataPath);
const planFile = () => join(app.getPath('userData'), 'plan.json');
const monthlyEventFile = () => join(app.getPath('userData'), 'monthly-events.json');
const blankPlan = { version: 1, plans: {} };
const blankMonthlyEvents = { version: 1, events: [] };
const epolyInstallGuideUrl = 'https://www.youtube.com/watch?v=g7CY3u4QoWU';
const githubRepositoryUrl = 'https://github.com/magune-lab/myholypoly';
const githubLatestReleaseApi = 'https://api.github.com/repos/magune-lab/myholypoly/releases/latest';
const githubReleasesApi = 'https://api.github.com/repos/magune-lab/myholypoly/releases?per_page=30';
const desktopShortcutPath = () => join(app.getPath('desktop'), 'myholypoly.lnk');
const retiredSettingsFiles = ['gemini-api-key.bin', 'ai-organizing-rules.txt'];
const polyWebLoginUrl = 'https://www.poly-english.com/member/login.do';
let polyWebWindow = null;
let mainWindow = null;
let appQuitting = false;

function isNewerVersion(latestVersion, currentVersion = app.getVersion()) {
  const latest = String(latestVersion).replace(/^v/i, '').split('.').map(Number);
  const current = String(currentVersion).replace(/^v/i, '').split('.').map(Number);
  for (let index = 0; index < Math.max(latest.length, current.length); index += 1) {
    if ((latest[index] || 0) !== (current[index] || 0)) return (latest[index] || 0) > (current[index] || 0);
  }
  return false;
}
async function latestRelease() {
  const response = await fetch(githubLatestReleaseApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'myholypoly-desktop' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('업데이트 정보를 가져오지 못했습니다.');
  return response.json();
}
async function releasesSinceCurrent() {
  const response = await fetch(githubReleasesApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'myholypoly-desktop' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('업데이트 내역을 가져오지 못했습니다.');
  const releases = await response.json();
  return releases.filter(release => !release.draft && !release.prerelease && isNewerVersion(String(release.tag_name || '').replace(/^v/i, '')));
}
function publicReleaseInfo(release, releases = [release]) {
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const installer = (release.assets || []).find(asset => /\.appx$/i.test(asset.name));
  return {
    available: isNewerVersion(latestVersion),
    currentVersion: app.getVersion(),
    latestVersion,
    name: release.name || `myholypoly v${latestVersion}`,
    notes: String(release.body || '').trim(),
    publishedAt: release.published_at || '',
    size: Number(installer?.size || 0),
    releaseUrl: release.html_url || githubRepositoryUrl,
    releases: releases.map(item => ({ version: String(item.tag_name || '').replace(/^v/i, ''), notes: String(item.body || '').trim(), publishedAt: item.published_at || '' }))
  };
}
function nextPatchVersion(version = app.getVersion()) {
  const parts = String(version).split('.').map(Number);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.slice(0, 3).join('.');
}
async function previewUpdateInfo() {
  let release = null;
  try { release = await latestRelease(); } catch {}
  return {
    available: true,
    test: true,
    currentVersion: app.getVersion(),
    latestVersion: (() => { const parts = app.getVersion().split('.').map(Number); parts[2] += 3; return parts.join('.'); })(),
    name: '업데이트 화면 테스트',
    notes: '좁은 일정의 완료 표시를 개선했어요.\n업데이트 내용을 앱 안에서 확인할 수 있어요.\n다운로드와 파일 검증 진행 상태를 더 분명하게 보여줘요.',
    publishedAt: new Date().toISOString(),
    size: Number((release?.assets || []).find(asset => /\.appx$/i.test(asset.name))?.size || 164000000),
    releaseUrl: release?.html_url || `${githubRepositoryUrl}/releases/latest`,
    releases: [1, 2, 3].map(offset => {
      const parts = app.getVersion().split('.').map(Number); parts[2] += offset;
      return { version: parts.join('.'), publishedAt: new Date(Date.now() + offset * 86400000).toISOString(), notes: [
        '숙제 화면을 더 알아보기 쉽게 다듬었어요.',
        offset === 2 ? '업데이트 알림과 설치 과정을 개선했어요.' : '작은 오류를 고치고 안정성을 높였어요.'
      ].join('\n') };
    }).reverse()
  };
}
async function simulateUpdate(event) {
  for (const percent of [4, 12, 24, 39, 55, 71, 86, 100]) {
    await new Promise(resolve => setTimeout(resolve, 150));
    event.sender.send('app:update-progress', { phase: 'downloading', percent, received: percent, total: 100 });
  }
  await new Promise(resolve => setTimeout(resolve, 450));
  event.sender.send('app:update-progress', { phase: 'verifying', percent: 100 });
  await new Promise(resolve => setTimeout(resolve, 550));
  event.sender.send('app:update-progress', { phase: 'launching', percent: 100, test: true });
  return { installed: true, test: true };
}
async function downloadUpdate(event) {
  const release = await latestRelease();
  const info = publicReleaseInfo(release);
  if (!info.available) return { installed: false, reason: 'up-to-date', ...info };
  const installer = (release.assets || []).find(asset => /\.appx$/i.test(asset.name));
  const checksum = (release.assets || []).find(asset => asset.name === 'SHA256SUMS.txt');
  if (!installer || !checksum) throw new Error('업데이트 설치 파일을 찾지 못했습니다.');
  const response = await fetch(installer.browser_download_url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error('업데이트 파일 다운로드에 실패했습니다.');
  const total = Number(response.headers.get('content-length') || installer.size || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    event.sender.send('app:update-progress', { phase: 'downloading', received, total, percent: total ? Math.round(received / total * 100) : 0 });
  }
  event.sender.send('app:update-progress', { phase: 'verifying', percent: 100 });
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  const checksumResponse = await fetch(checksum.browser_download_url, { signal: AbortSignal.timeout(15000) });
  if (!checksumResponse.ok) throw new Error('업데이트 파일 검증 정보를 가져오지 못했습니다.');
  const checksumText = await checksumResponse.text();
  const expected = checksumText.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts.at(-1) === installer.name)?.[0]?.toLowerCase();
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!expected || actual !== expected) throw new Error('업데이트 파일 검증에 실패했습니다. 다시 시도해 주세요.');
  const updateDirectory = join(app.getPath('temp'), 'myholypoly-update');
  await mkdir(updateDirectory, { recursive: true });
  const installerPath = join(updateDirectory, installer.name);
  await writeFile(installerPath, bytes);
  event.sender.send('app:update-progress', { phase: 'launching', percent: 100 });
  const openError = await shell.openPath(installerPath);
  if (openError) throw new Error(`Windows 설치 화면을 열지 못했습니다. ${openError}`);
  return { installed: true, installerPath, ...info };
}

async function readPlan() {
  return readJsonFile(
    planFile(),
    blankPlan,
    value => value && typeof value === 'object' && !Array.isArray(value)
      && value.plans && typeof value.plans === 'object' && !Array.isArray(value.plans),
    '숙제 데이터'
  );
}
async function savePlan(plan) {
  await mkdir(dirname(planFile()), { recursive: true });
  await writeFile(planFile(), JSON.stringify(plan, null, 2), 'utf8');
}
async function readMonthlyEvents() {
  return readJsonFile(
    monthlyEventFile(),
    blankMonthlyEvents,
    value => value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.events),
    '시험 달력 데이터'
  );
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
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('app:check-update', async () => {
    try {
      const releases = await releasesSinceCurrent();
      const release = releases[0] || await latestRelease();
      return publicReleaseInfo(release, releases.length ? releases : [release]);
    }
    catch (error) { return { available: false, currentVersion: app.getVersion(), error: error.message }; }
  });
  ipcMain.handle('app:download-update', event => downloadUpdate(event));
  ipcMain.handle('app:preview-update', () => previewUpdateInfo());
  ipcMain.handle('app:simulate-update', event => simulateUpdate(event));
  ipcMain.handle('app:open-repository', () => shell.openExternal(`${githubRepositoryUrl}/releases/latest`));
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
  removeRetiredSettings().catch(error => console.error('사용하지 않는 설정 파일 정리 실패:', error));
  if (app.isPackaged) {
    desktopShortcutExists()
      .then(exists => exists ? setDesktopShortcut(true) : null)
      .catch(error => console.error('바탕화면 바로가기 업데이트 실패:', error));
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { appQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
