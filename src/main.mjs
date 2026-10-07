import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from 'electron';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHomeworkByDate, captureOpenHomework, captureTodayHomework, getEpolyStatus, launchEpoly, openCalendar } from './services/epoly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appIcon = join(here, '..', 'assets', 'myholypoly.ico');
// Keep user data independent from the executable/version folder so extracted
// releases and development builds all read the same schedules and localStorage.
const persistentDataPath = join(app.getPath('appData'), 'myholypoly');
app.setPath('userData', persistentDataPath);
const planFile = () => join(app.getPath('userData'), 'plan.json');
const geminiKeyFile = () => join(app.getPath('userData'), 'gemini-api-key.bin');
const aiRulesFile = () => join(app.getPath('userData'), 'ai-organizing-rules.txt');
const blankPlan = { version: 1, plans: {} };
const epolyInstallGuideUrl = 'https://www.youtube.com/watch?v=g7CY3u4QoWU';
const geminiApiKeysUrl = 'https://aistudio.google.com/app/apikey';
const geminiGuideUrl = 'https://ai.google.dev/gemini-api/docs/api-key';
const githubRepositoryUrl = 'https://github.com/magune-lab/myholypoly';

async function readPlan() {
  try { return JSON.parse(await readFile(planFile(), 'utf8')); }
  catch { return structuredClone(blankPlan); }
}
async function savePlan(plan) {
  await mkdir(dirname(planFile()), { recursive: true });
  await writeFile(planFile(), JSON.stringify(plan, null, 2), 'utf8');
}
async function readGeminiKey() {
  if (!safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(await readFile(geminiKeyFile())); }
  catch { return ''; }
}
async function saveGeminiKey(key) {
  const normalized = String(key || '').trim();
  if (normalized.length < 20) throw new Error('올바른 Gemini API 키를 입력해 주세요.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 API 키 암호화 저장을 사용할 수 없습니다.');
  await mkdir(dirname(geminiKeyFile()), { recursive: true });
  await writeFile(geminiKeyFile(), safeStorage.encryptString(normalized));
  return { configured: true };
}
async function deleteGeminiKey() {
  try { await unlink(geminiKeyFile()); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return { configured: false };
}
async function readAiRules() {
  try { return String(await readFile(aiRulesFile(), 'utf8')).trim(); }
  catch { return ''; }
}
async function saveAiRules(value) {
  const rules = String(value || '').trim().slice(0, 6000);
  await mkdir(dirname(aiRulesFile()), { recursive: true });
  await writeFile(aiRulesFile(), rules, 'utf8');
  return { rules };
}
async function resetAiRules() {
  try { await unlink(aiRulesFile()); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return { rules: '' };
}
async function suggestHomeworkText(text) {
  const sourceText = String(text || '').trim();
  if (!sourceText) throw new Error('다듬을 할 일 문구를 먼저 입력해 주세요.');
  const apiKey = await readGeminiKey();
  if (!apiKey) throw new Error('AI 설정에서 Gemini API 키를 먼저 등록해 주세요.');
  let response;
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: '교사가 수기로 작성한 구체적인 숙제 할 일 한 항목을 짧고 읽기 좋게 정리하세요. 과목 이름은 편집 대상이 아닙니다. 원문의 언어와 의미, 고유명사, 교재명, 페이지 번호, 날짜, 숫자, 기호는 바꾸거나 생략하지 마세요. 줄바꿈, 반복되거나 불필요한 안내 표현, 과도한 공백, 맞춤법과 문장 흐름만 정리하세요. 새로운 숙제 내용을 추측하거나 추가하지 마세요. 설명이나 따옴표 없이 다듬은 할 일 문구 한 개만 출력하세요.' }] },
        contents: [{ role: 'user', parts: [{ text: sourceText }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 220, candidateCount: 1 }
      })
    });
  } catch {
    throw new Error('인터넷 연결을 확인한 뒤 AI 추천을 다시 시도해 주세요.');
  }
  const data = await response.json().catch(() => ({}));
  if ([400, 401, 403].includes(response.status)) throw new Error('Gemini API 키가 올바르지 않거나 사용할 수 없습니다. AI 설정에서 키를 다시 확인해 주세요.');
  if (response.status === 429) throw new Error('API 사용 한도 또는 결제 상태를 확인해 주세요.');
  if (!response.ok) throw new Error(data?.error?.message || 'AI 문구 추천을 불러오지 못했습니다.');
  const suggestion = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!suggestion) throw new Error('AI가 추천 문구를 만들지 못했습니다. 다시 시도해 주세요.');
  return { text: suggestion };
}

async function organizeHomeworkSchedule(items) {
  const sourceItems = Array.isArray(items) ? items.map((item, index) => ({
    index,
    title: String(item?.title || '').trim(),
    dueDate: String(item?.dueDate || ''),
    tasks: String(item?.detail || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  })).filter(item => item.title && item.tasks.length) : [];
  if (!sourceItems.length) return { items: [] };
  const apiKey = await readGeminiKey();
  if (!apiKey) throw new Error('AI 설정에서 Gemini API 키를 먼저 등록해 주세요.');
  const customRules = await readAiRules();
  let response;
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `교사가 작성한 숙제 일정 전체를 학생이 바로 실행할 수 있는 체크리스트로 정리하세요. 과목명(title), 마감일(dueDate), courseIndex는 절대 수정하지 마세요. 같은 과목 안에서만 불필요한 안내 문구와 과도한 공백·줄바꿈을 제거하고, 한 줄에 여러 행동이 섞이면 명확한 할 일로 분리하며, 의미가 이어지는 잘못된 줄바꿈은 병합하세요. 원문의 언어, 의미, 고유명사, 교재명, 페이지, 날짜, 숫자는 보존하고 새로운 내용을 추측하거나 추가하지 마세요. 상위 활동명과 그 아래 세부 활동의 계층 관계를 유지하고, 각 tasks 항목은 그 관계가 드러나는 짧고 독립적인 한 줄이어야 합니다.${customRules ? `\n\n사용자가 지정한 추가 정리 규칙:\n${customRules}` : ''}` }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(sourceItems) }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1800,
          candidateCount: 1,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['courseIndex', 'tasks'],
              properties: {
                courseIndex: { type: 'INTEGER' },
                tasks: { type: 'ARRAY', items: { type: 'STRING' } }
              }
            }
          }
        }
      })
    });
  } catch {
    throw new Error('인터넷 연결을 확인한 뒤 AI 일정 정리를 다시 시도해 주세요.');
  }
  const data = await response.json().catch(() => ({}));
  if ([400, 401, 403].includes(response.status)) throw new Error('Gemini API 키가 올바르지 않거나 사용할 수 없습니다. AI 설정에서 키를 다시 확인해 주세요.');
  if (response.status === 429) throw new Error('API 사용 한도 또는 결제 상태를 확인해 주세요.');
  if (!response.ok) throw new Error(data?.error?.message || 'AI 일정 정리 결과를 불러오지 못했습니다.');
  const raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  let organized;
  try { organized = JSON.parse(raw); } catch { throw new Error('AI 일정 정리 결과를 읽지 못했습니다. 다시 시도해 주세요.'); }
  const byIndex = new Map((Array.isArray(organized) ? organized : []).map(item => [Number(item.courseIndex), item]));
  return {
    items: sourceItems.map(source => {
      const tasks = Array.isArray(byIndex.get(source.index)?.tasks)
        ? byIndex.get(source.index).tasks.map(task => String(task || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
        : source.tasks;
      return { courseIndex: source.index, detail: (tasks.length ? tasks : source.tasks).join('\n') };
    })
  };
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
  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('app:open-repository', () => shell.openExternal(githubRepositoryUrl));
  ipcMain.handle('epoly:status', () => getEpolyStatus());
  ipcMain.handle('epoly:launch', () => launchEpoly());
  ipcMain.handle('epoly:open-homework', () => captureOpenHomework());
  ipcMain.handle('epoly:today-homework', () => captureTodayHomework());
  ipcMain.handle('epoly:date-homework', (_event, date) => captureHomeworkByDate(date));
  ipcMain.handle('epoly:open-calendar', () => openCalendar());
  ipcMain.handle('epoly:open-install-guide', () => shell.openExternal(epolyInstallGuideUrl));
  ipcMain.handle('ai:key-status', async () => ({ configured: Boolean(await readGeminiKey()) }));
  ipcMain.handle('ai:save-key', (_event, key) => saveGeminiKey(key));
  ipcMain.handle('ai:delete-key', () => deleteGeminiKey());
  ipcMain.handle('ai:read-rules', () => readAiRules().then(rules => ({ rules })));
  ipcMain.handle('ai:save-rules', (_event, rules) => saveAiRules(rules));
  ipcMain.handle('ai:reset-rules', () => resetAiRules());
  ipcMain.handle('ai:suggest', (_event, text) => suggestHomeworkText(text));
  ipcMain.handle('ai:organize-schedule', (_event, items) => organizeHomeworkSchedule(items));
  ipcMain.handle('ai:open-api-keys', () => shell.openExternal(geminiApiKeysUrl));
  ipcMain.handle('ai:open-guide', () => shell.openExternal(geminiGuideUrl));
  ipcMain.handle('plan:read', () => readPlan());
  ipcMain.handle('plan:register', async (_event, draft) => {
    if (!draft?.date || !Array.isArray(draft.items)) throw new Error('등록할 일정 형식이 올바르지 않습니다.');
    const plan = await readPlan();
    const previous = plan.plans[draft.date];
    plan.plans[draft.date] = {
      date: draft.date,
      items: draft.items.map(({ title, detail, originalDetail = detail, refinedLines = [], startDate = draft.date, dueDate = '', done = [] }) => ({ title, detail, originalDetail, refinedLines: Array.isArray(refinedLines) ? refinedLines.map(Boolean) : [], startDate, dueDate, done: Array.isArray(done) ? done.map(Boolean) : [] })),
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
      originalDetail: item.originalDetail || previous.originalDetail || item.detail || '',
      refinedLines: Array.isArray(item.refinedLines) ? item.refinedLines.map(Boolean) : (previous.refinedLines || []),
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
