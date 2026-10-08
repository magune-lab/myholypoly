const $ = selector => document.querySelector(selector);
const now = new Date();
const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const bridge = window.myholypoly;
bridge.appInfo.read().then(({ version }) => { $('#appVersion').textContent = `v${version}`; }).catch(() => {});
$('#openGithubRepository').onclick = event => { event.preventDefault(); bridge.appInfo.openRepository(); };
$('#minimizeApp').onclick = () => bridge.windowControls.minimize();
$('#closeApp').onclick = () => window.close();
async function toggleMaximize() {
  const maximized = await bridge.windowControls.toggleMaximize();
  document.body.classList.toggle('is-maximized', maximized);
  $('#maximizeApp').title = maximized ? '이전 크기로 복원' : '최대화';
  $('#maximizeApp').setAttribute('aria-label', maximized ? '창 이전 크기' : '창 최대화');
}
$('#maximizeApp').onclick = toggleMaximize;
const brand = document.querySelector('.brand');
if (brand) brand.ondblclick = toggleMaximize;
const aiSettingsDialog = $('#aiSettingsDialog');
function updateAiSettingsButton(configured) {
  const state = $('#aiConnectionState');
  state.classList.toggle('connected', configured);
  state.innerHTML = `<i aria-hidden="true"></i>${configured ? 'AI 자동 정리 사용 중' : 'AI 자동 정리 꺼짐'}`;
  $('#aiSettings').textContent = '설정';
}
async function openAiSettings() {
  $('#geminiApiKey').value = '';
  $('#aiKeyStatus').textContent = '확인 중…';
  aiSettingsDialog.showModal();
  try {
    const [{ configured }, { rules }] = await Promise.all([bridge.ai.keyStatus(), bridge.ai.readRules()]);
    updateAiSettingsButton(configured);
    $('#aiCustomRules').value = rules || '';
    $('#aiKeyStatus').textContent = configured ? 'API 키가 안전하게 등록되어 있습니다.' : '등록된 API 키가 없습니다.';
    $('#deleteAiKey').hidden = !configured;
  } catch (error) { $('#aiKeyStatus').textContent = error.message; }
}
$('#aiSettings').onclick = openAiSettings;
$('#closeAiSettings').onclick = () => aiSettingsDialog.close();
$('#cancelAiSettings').onclick = () => aiSettingsDialog.close();
$('#openApiKeys').onclick = () => bridge.ai.openApiKeys();
$('#openGeminiGuide').onclick = () => bridge.ai.openGuide();
$('#saveAiKey').onclick = async () => {
  try {
    const key = $('#geminiApiKey').value.trim();
    if (key) await bridge.ai.saveKey(key);
    else {
      const { configured } = await bridge.ai.keyStatus();
      if (!configured) throw new Error('Gemini API 키를 입력해 주세요.');
    }
    await bridge.ai.saveRules($('#aiCustomRules').value);
    $('#geminiApiKey').value = '';
    $('#aiKeyStatus').textContent = 'API 키와 AI 정리 규칙을 저장했습니다.';
    $('#deleteAiKey').hidden = false;
    updateAiSettingsButton(true);
  } catch (error) { $('#aiKeyStatus').textContent = error.message; }
};
$('#resetAiRules').onclick = async () => {
  try {
    await bridge.ai.resetRules();
    $('#aiCustomRules').value = '';
    $('#aiKeyStatus').textContent = '추가 정리 규칙을 초기화했습니다. 기본 규칙은 계속 적용됩니다.';
  } catch (error) { $('#aiKeyStatus').textContent = error.message; }
};
$('#deleteAiKey').onclick = async () => {
  await bridge.ai.deleteKey();
  $('#geminiApiKey').value = '';
  $('#aiKeyStatus').textContent = '등록된 API 키를 삭제했습니다.';
  $('#deleteAiKey').hidden = true;
  updateAiSettingsButton(false);
};
bridge.ai.keyStatus().then(({ configured }) => updateAiSettingsButton(configured)).catch(() => updateAiSettingsButton(false));
let source = 'manual';
let courses = [];
let activeCourseIndex = 0;
let editingTarget = null;
let inlineCourseDraft = null;
let savedPlans = {};
let selectedCourseKey = '';
let focusId = '';
function prepareProgressFocus(key) {
  if (!key) return;
  selectedCourseKey = key;
  focusId = key;
  overviewScope = 'all';
  progressScope = 'all';
  hideCompleted = false;
  localStorage.setItem(scopeStorageKey, 'all');
  localStorage.setItem(hideCompletedStorageKey, 'false');
  syncScopeTabs();
  syncHideCompleted();
}
let pageHistory = ['overview'];
let pageHistoryIndex = 0;
const scopeStorageKey = 'myholypoly.scheduleScope';
const hideCompletedStorageKey = 'myholypoly.hideCompleted';
const validScopes = ['urgent', 'today', 'week', 'all'];
const storedScope = localStorage.getItem(scopeStorageKey);
let overviewScope = validScopes.includes(storedScope) ? storedScope : 'all';
let hideCompleted = localStorage.getItem(hideCompletedStorageKey) === 'true';
let registerStep = 1;
let statusRefreshPromise = null;
const maxCourses = 5;
const expandedComparisons = new Set();
const expandedOriginalCourses = new Set();
const lines = course => String(course.detail || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const isItemComplete = item => { const itemLines = lines(item); return itemLines.length > 0 && itemLines.every((_, index) => Boolean(item.done?.[index])); };
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const coursePalettes = [
  { bg: '#FF9EC0', border: '#1B2845', soft: '#FFE8F0', text: '#1B2845' },
  { bg: '#7DB2FF', border: '#1B2845', soft: '#E7F1FF', text: '#1B2845' },
  { bg: '#FFD84D', border: '#1B2845', soft: '#FFF5C9', text: '#1B2845' },
  { bg: '#FFB88A', border: '#1B2845', soft: '#FFF0E6', text: '#1B2845' },
  { bg: '#5ED6A0', border: '#1B2845', soft: '#E2F9EF', text: '#1B2845' },
  { bg: '#B79CFF', border: '#1B2845', soft: '#EEE8FF', text: '#1B2845' },
  { bg: '#70D6E8', border: '#1B2845', soft: '#E3F8FB', text: '#1B2845' },
  { bg: '#FF8E7B', border: '#1B2845', soft: '#FFE9E5', text: '#1B2845' }
];
function courseKey(title, dueDate) { return `${title || ''}|${dueDate || ''}`; }
function coursePalette(title = '') {
  let hash = 0;
  for (const character of title) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return coursePalettes[hash % coursePalettes.length];
}
function coursePaletteMap(items) {
  const titles = [...new Set(items.map(item => String(item.title || '과목').trim()))].sort((a, b) => a.localeCompare(b));
  const used = new Set();
  return new Map(titles.map(title => {
    let index = coursePalettes.indexOf(coursePalette(title));
    while (used.has(index) && used.size < coursePalettes.length) index = (index + 1) % coursePalettes.length;
    used.add(index);
    return [title, coursePalettes[index]];
  }));
}
let activeDateInput = null;
let pickerYear = now.getFullYear();
let pickerMonth = now.getMonth();
let datePickerStage = 'months';
function isoDate(year, month, day) { return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function homeworkMonths(year) {
  return new Set(allItems().flatMap(item => [item.startDate || item.date, item.dueDate]).filter(Boolean).filter(value => Number(value.slice(0, 4)) === year).map(value => Number(value.slice(5, 7))));
}
function renderDatePicker() {
  const selectingMonth = datePickerStage === 'months';
  $('#datePickerHeading').textContent = selectingMonth ? `${pickerYear}년` : `${pickerYear}년 ${pickerMonth + 1}월`;
  $('#datePickerMonths').hidden = !selectingMonth;
  $('#datePickerBackToMonths').hidden = selectingMonth;
  $('.date-picker-week').hidden = selectingMonth;
  $('#datePickerDays').hidden = selectingMonth;
  const markedMonths = homeworkMonths(pickerYear);
  $('#datePickerMonths').innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const selected = pickerMonth === index;
    return `<button type="button" data-picker-month="${index}" class="${selected ? 'selected' : ''}">${month}월${markedMonths.has(month) ? '<i></i>' : ''}</button>`;
  }).join('');
  $('#datePickerMonths').querySelectorAll('button').forEach(button => button.onclick = event => {
    event.stopPropagation(); pickerMonth = Number(button.dataset.pickerMonth); datePickerStage = 'days'; renderDatePicker();
  });
  if (selectingMonth) return;
  const firstDay = new Date(pickerYear, pickerMonth, 1).getDay();
  const days = new Date(pickerYear, pickerMonth + 1, 0).getDate();
  const previousDays = new Date(pickerYear, pickerMonth, 0).getDate();
  const selected = activeDateInput?.value || '';
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    let year = pickerYear; let month = pickerMonth; let day; let outside = false;
    if (index < firstDay) { day = previousDays - firstDay + index + 1; month -= 1; outside = true; }
    else if (index >= firstDay + days) { day = index - firstDay - days + 1; month += 1; outside = true; }
    else day = index - firstDay + 1;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    const value = isoDate(year, month, day);
    const scheduled = allItems().some(item => [item.startDate || item.date, item.dueDate].includes(value));
    cells.push(`<button type="button" data-date="${value}" class="${outside ? 'outside' : ''} ${value === selected ? 'selected' : ''} ${value === today ? 'today' : ''}"><span>${day}</span>${scheduled ? '<i></i>' : ''}</button>`);
  }
  $('#datePickerDays').innerHTML = cells.join('');
  $('#datePickerDays').querySelectorAll('button').forEach(button => button.onclick = event => {
    event.stopPropagation();
    if (!activeDateInput) return;
    activeDateInput.value = button.dataset.date;
    activeDateInput.dispatchEvent(new Event('input', { bubbles: true }));
    closeDatePicker();
  });
}
function openDatePicker(input, anchor = input) {
  activeDateInput = input;
  const value = input.value ? new Date(`${input.value}T00:00:00`) : new Date();
  pickerYear = value.getFullYear(); pickerMonth = value.getMonth();
  datePickerStage = 'days';
  renderDatePicker();
  const popover = $('#datePickerPopover');
  popover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = 238;
  const edge = 12;
  const bottomSafeArea = document.body.classList.contains('is-maximized') ? 56 : edge;
  popover.style.maxHeight = `${Math.max(240, window.innerHeight - edge - bottomSafeArea)}px`;
  popover.style.overflowY = 'auto';
  popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  const popoverHeight = Math.min(popover.offsetHeight, window.innerHeight - edge - bottomSafeArea);
  const below = rect.bottom + 9;
  const above = rect.top - popoverHeight - 9;
  const preferredTop = below + popoverHeight <= window.innerHeight - bottomSafeArea ? below : above;
  popover.style.top = `${Math.max(edge, Math.min(preferredTop, window.innerHeight - popoverHeight - bottomSafeArea))}px`;
}
function closeDatePicker() { $('#datePickerPopover').hidden = true; activeDateInput = null; }
function bindDatePicker(input, trigger = input) { trigger.onclick = event => { event.stopPropagation(); openDatePicker(input, trigger); }; trigger.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDatePicker(input, trigger); } if (event.key === 'Escape') closeDatePicker(); }; }
function setMessage(message, isError = false) { const node = $('#message'); node.textContent = String(message || '').replace(/^Error invoking remote method '[^']+': Error:\s*/i, ''); node.classList.toggle('error', isError); }
function setStepMessage(step, message = '', type = 'info') { const node = $('#importMessage'); if (!node) return; const text = String(message || '').replace(/^Error invoking remote method '[^']+': Error:\s*/i, ''); const steps = [...document.querySelectorAll('#registerSteps > div')]; const target = steps[Math.max(1, Math.min(4, step)) - 1]; if (target && node.parentElement !== target) target.append(node); node.hidden = !text; node.textContent = text; node.dataset.type = type; }
function setImportMessage(message = '', type = 'info') { setStepMessage(3, message, type); }
function renderCourses() {
  const editor = $('#courseEditor');
  if (!courses.length) {
    activeCourseIndex = -1;
    editor.innerHTML = '';
    return;
  }
  activeCourseIndex = Math.min(activeCourseIndex, courses.length - 1);
  editor.innerHTML = courses.map((course, courseIndex) => {
    const itemLines = String(course.detail || '').split(/\r?\n/);
    const originalLines = course.originalLines || itemLines;
    const refinedLines = course.refinedLines || [];
    const originalDetail = (course.originalLines || []).join('\n');
    const aiRefined = originalDetail.trim() !== String(course.detail || '').trim();
    const palette = coursePalette(course.title || `과목 ${courseIndex + 1}`);
    const taskCount = Math.max(1, itemLines.filter(line => line.trim()).length);
    const dueDiff = course.dueDate ? Math.ceil((new Date(`${course.dueDate}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : '';
    const dueBadge = dueDiff === '' ? '마감일 없음' : dueDiff < 0 ? '기한 지남' : dueDiff === 0 ? 'D-day' : `D-${dueDiff}`;
    const taskMarkup = itemLines.map((line, lineIndex) => {
      const refined = Boolean(refinedLines[lineIndex]);
      const comparisonKey = `${courseIndex}:${lineIndex}`;
      return `<div class="focus-course-entry"><label class="focus-course-line"><span>${String(lineIndex + 1).padStart(2, '0')}</span><span class="task-input-wrap"><input data-course-line="${courseIndex}" data-line="${lineIndex}" value="${escapeHtml(line)}" placeholder="할 일"></span><button type="button" data-remove-line="${comparisonKey}" aria-label="항목 삭제">삭제</button></label></div>`;
    }).join('');
    const showOriginal = aiRefined && expandedOriginalCourses.has(courseIndex);
    const comparison = showOriginal ? `<div class="schedule-original-comparison"><div><b>불러온 원본</b><p>${escapeHtml(originalDetail).replace(/\n/g, '<br>')}</p></div><div><b>AI로 구성한 일정</b><p>${escapeHtml(course.detail).replace(/\n/g, '<br>')}</p></div><button type="button" data-restore-course="${courseIndex}">이 과목은 원본 사용</button></div>` : '';
    const aiBadge = aiRefined ? '<span class="course-accordion-chip ai-organized-chip">AI 정리</span>' : '';
    const originalButton = aiRefined ? `<button type="button" class="show-course-original" data-show-course-original="${courseIndex}" aria-expanded="${showOriginal}">${showOriginal ? '원본 닫기' : '원본 보기'}</button>` : '';
    return `<article class="stacked-course ${courseIndex === activeCourseIndex ? 'active' : ''}" data-course="${courseIndex}" style="--course-bg:${palette.bg};--course-soft:${palette.soft}"><button type="button" class="course-accordion-head" data-toggle-course="${courseIndex}" aria-expanded="${courseIndex === activeCourseIndex}"><span class="course-accordion-number">${courseIndex + 1}</span><span class="course-accordion-summary"><strong class="course-accordion-name">${escapeHtml(course.title || '새 과목')}</strong><small>마감 ${course.dueDate ? formatDate(course.dueDate) : '미정'}</small></span>${aiBadge}<span class="course-accordion-chip">${dueBadge}</span><span class="course-accordion-chip">할 일 ${taskCount}개</span><span class="course-accordion-chevron" aria-hidden="true"></span></button><div class="course-accordion-body"><div class="course-original-tools">${originalButton}</div>${comparison}<div class="focus-course-lines">${taskMarkup}</div><button class="add-focus-line" data-add-line="${courseIndex}" type="button">＋ 내용 추가</button></div></article>`;
  }).join('');
  const selectCourse = index => { activeCourseIndex = index; editor.querySelectorAll('.stacked-course').forEach((card, cardIndex) => { const active = cardIndex === index; card.classList.toggle('active', active); card.querySelector('.course-accordion-head')?.setAttribute('aria-expanded', String(active)); }); };
  editor.querySelectorAll('.stacked-course').forEach((card, index) => card.onclick = () => selectCourse(index));
  editor.querySelectorAll('[data-toggle-course]').forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); selectCourse(Number(button.dataset.toggleCourse)); });
  editor.querySelectorAll('[data-course-title]').forEach(input => input.oninput = event => { const index = Number(event.target.dataset.courseTitle); courses[index].title = event.target.value; event.target.closest('.stacked-course')?.querySelector('.course-accordion-name')?.replaceChildren(event.target.value || '새 과목'); selectCourse(index); });
  editor.querySelectorAll('[data-course-due]').forEach(input => { input.oninput = event => { const index = Number(event.target.dataset.courseDue); courses[index].dueDate = event.target.value; const summaryDate = event.target.closest('.stacked-course')?.querySelector('.course-accordion-summary small'); if (summaryDate) summaryDate.textContent = `마감 ${event.target.value ? formatDate(event.target.value) : '미정'}`; selectCourse(index); }; bindDatePicker(input); });
  editor.querySelectorAll('[data-course-line]').forEach(input => input.oninput = event => { const index = Number(event.target.dataset.courseLine); const lineIndex = Number(event.target.dataset.line); const card = event.target.closest('.stacked-course'); if (!courses[index].refinedLines?.[lineIndex]) courses[index].originalLines[lineIndex] = event.target.value; courses[index].detail = [...card.querySelectorAll('[data-course-line]')].map(node => node.value).join('\n'); selectCourse(index); });
  editor.querySelectorAll('[data-show-course-original]').forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); const index = Number(button.dataset.showCourseOriginal); if (expandedOriginalCourses.has(index)) expandedOriginalCourses.delete(index); else expandedOriginalCourses.add(index); activeCourseIndex = index; renderCourses(); });
  editor.querySelectorAll('[data-restore-course]').forEach(button => button.onclick = event => { event.stopPropagation(); const index = Number(button.dataset.restoreCourse); const course = courses[index]; course.detail = course.originalLines.join('\n'); course.refinedLines = course.originalLines.map(() => false); expandedOriginalCourses.delete(index); setMessage('선택한 과목을 불러온 원본으로 복원했습니다.'); renderCourses(); });
  editor.querySelectorAll('[data-remove-line]').forEach(button => button.onclick = event => { event.stopPropagation(); const [courseIndex, lineIndex] = button.dataset.removeLine.split(':').map(Number); const course = courses[courseIndex]; const values = String(course.detail || '').split(/\r?\n/); values.splice(lineIndex, 1); course.originalLines.splice(lineIndex, 1); course.refinedLines.splice(lineIndex, 1); course.detail = values.join('\n'); expandedComparisons.clear(); activeCourseIndex = courseIndex; renderCourses(); });
  editor.querySelectorAll('[data-add-line]').forEach(button => button.onclick = event => { event.stopPropagation(); const index = Number(button.dataset.addLine); const course = courses[index]; course.detail = `${course.detail}${course.detail ? '\n' : ''}새 항목`; course.originalLines.push('새 항목'); course.refinedLines.push(false); activeCourseIndex = index; renderCourses(); const card = editor.querySelector(`[data-course="${index}"]`); const inputs = card.querySelectorAll('[data-course-line]'); inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); });
  $('#deleteCourse').onclick = () => {
    if (courses.length <= 1) {
      courses = [{ title: '', detail: '', originalLines: [''], refinedLines: [false], dueDate: '', startDate: $('#planDate').value }];
      activeCourseIndex = 0;
    } else {
      courses.splice(activeCourseIndex, 1);
      activeCourseIndex = Math.max(0, activeCourseIndex - 1);
    }
    renderCourses();
  };
  const hasAiChanges = courses.some(course => course.originalLines.join('\n').trim() !== String(course.detail || '').trim());
  $('#compareAllOriginals').hidden = !hasAiChanges;
  const changedIndices = courses.map((course, index) => course.originalLines.join('\n').trim() !== String(course.detail || '').trim() ? index : -1).filter(index => index >= 0);
  $('#compareAllOriginals').textContent = changedIndices.length && changedIndices.every(index => expandedOriginalCourses.has(index)) ? '전체 비교 닫기' : '전체 원본 비교';
}
function setCourses(items) { expandedComparisons.clear(); expandedOriginalCourses.clear(); courses = items.map(item => { const detail = item.detail || ''; const itemLines = String(detail).split(/\r?\n/); const originals = Array.isArray(item.originalLines) ? item.originalLines : String(item.originalDetail ?? detail).split(/\r?\n/); const changed = originals.join('\n').trim() !== detail.trim(); return { title: item.title || '', detail, originalLines: originals, refinedLines: itemLines.map(() => changed), dueDate: item.dueDate || '', startDate: item.startDate || '' }; }); activeCourseIndex = 0; renderCourses(); }
async function organizeImportedCourses(items) {
  const { configured } = await bridge.ai.keyStatus();
  if (!configured) return { items, organized: false };
  setStepMessage(3, 'AI가 전체 일정을 보기 좋게 구성하고 있습니다.');
  const result = await bridge.ai.organizeSchedule(items);
  const organizedByIndex = new Map((result.items || []).map(item => [Number(item.courseIndex), item.detail]));
  return {
    organized: true,
    items: items.map((item, index) => {
      const originalDetail = String(item.detail || '');
      const detail = organizedByIndex.get(index) || originalDetail;
      return { ...item, detail, originalDetail, originalLines: originalDetail.split(/\r?\n/), refinedLines: detail.split(/\r?\n/).map(() => detail.trim() !== originalDetail.trim()) };
    })
  };
}
function draft() { return { date: $('#planDate').value, source, items: courses.filter(course => course.title).map(course => ({ title: course.title, detail: course.detail, originalDetail: course.originalLines.join('\n'), refinedLines: course.refinedLines, dueDate: course.dueDate, startDate: course.startDate || $('#planDate').value })) }; }
function setEditingMode(target = null) { editingTarget = target; const editing = Boolean(target); $('#addTask').hidden = editing; $('#deleteCourse').hidden = editing; $('#planDate').disabled = editing; ['#planDatePrevious', '#planDateButton', '#planDateNext'].forEach(selector => { $(selector).disabled = editing; }); $('#register').textContent = editing ? '수정 저장' : '일정 등록'; }
const dateValue = value => value ? new Date(`${value}T00:00:00`) : null;
const formatDate = value => value ? value.slice(5).replace('-', '.') : '마감일 없음';
const dayDiff = value => { const target = dateValue(value); if (!target) return ''; return Math.ceil((target - new Date(today + 'T00:00:00')) / 86400000); };
function currentWeekRange() {
  const start = dateValue(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start: isoDate(start.getFullYear(), start.getMonth(), start.getDate()), end: isoDate(end.getFullYear(), end.getMonth(), end.getDate()) };
}
function allItems() { return Object.entries(savedPlans).flatMap(([date, plan]) => (plan.items || []).map((item, itemIndex) => ({ ...item, date, itemIndex, startDate: item.startDate || date }))).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')); }
function renderChecklist() { const host = $('#checklistList'); const items = allItems(); host.innerHTML = ''; if (!items.length) { host.innerHTML = '<p class="muted">등록된 일정이 없습니다.</p>'; return; } items.forEach(item => { const itemLines = lines(item); const done = item.done || []; const remaining = itemLines.filter((_, index) => !done[index]).length; const dday = dayDiff(item.dueDate); const badge = dday === '' ? '' : dday < 0 ? '기한 지남' : dday === 0 ? 'D-day' : `D-${dday}`; const card = document.createElement('article'); card.className = 'check-course'; card.innerHTML = `<header><div><span class="course-dot"></span><strong>${escapeHtml(item.title)}</strong><small>시작일 ${formatDate(item.startDate)} · 마감 ${formatDate(item.dueDate)}</small></div><span class="deadline ${dday < 0 ? 'late' : ''}">${badge}</span></header><div class="check-lines">${itemLines.map((line, lineIndex) => `<label><input type="checkbox" data-date="${item.date}" data-item="${item.itemIndex}" data-line="${lineIndex}" ${done[lineIndex] ? 'checked' : ''}/><span>${escapeHtml(line)}</span></label>`).join('') || '<p class="muted">내용이 없습니다.</p>'}</div><footer>${itemLines.length - remaining}/${itemLines.length} 완료</footer>`; host.append(card); }); host.querySelectorAll('input[type=checkbox]').forEach(input => input.onchange = async () => { try { const result = await bridge.plan.toggleLine(input.dataset.date, Number(input.dataset.item), Number(input.dataset.line), input.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); input.checked = !input.checked; } }); }
function renderGantt() {
  const host = $('#ganttChart');
  const monthValue = $('#ganttMonth').value || today.slice(0, 7);
  const [year, month] = monthValue.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const first = `${monthValue}-01`;
  const last = `${monthValue}-${String(days).padStart(2, '0')}`;
  const week = currentWeekRange();
  const monthItems = allItems().filter(item => (item.startDate || item.date) <= last && (item.dueDate || item.startDate || item.date) >= first);
  const items = monthItems.filter(item => {
    if (hideCompleted && isItemComplete(item)) return false;
    if (overviewScope === 'all') return true;
    const due = item.dueDate || item.startDate || item.date;
    const diff = dayDiff(due);
    if (overviewScope === 'urgent') return diff !== '' && diff >= 0 && diff <= 3;
    if (overviewScope === 'today') return due === today;
    return due >= week.start && due <= week.end;
  });
  const paletteByCourse = coursePaletteMap(items);
  $('#ganttCount').textContent = overviewScope === 'urgent' ? `3일 이내 · ${items.length}개` : `${items.length}개 일정`;
  if (!items.length) { host.innerHTML = `<p class="muted">${overviewScope === 'all' ? '이 달에 표시할 일정이 없습니다.' : '선택한 범위에 남은 일정이 없습니다.'}</p>`; return; }
  const axis = Array.from({ length: days }, (_, index) => {
    const value = `${monthValue}-${String(index + 1).padStart(2, '0')}`;
    return `<th class="day-col ${value === today ? 'today-col' : ''}"><span>${index + 1}</span></th>`;
  }).join('');
  const rows = items.map(item => {
    const start = item.startDate || item.date;
    const end = item.dueDate || start;
    const startDay = Math.max(1, Math.floor((dateValue(start) - dateValue(first)) / 86400000) + 1);
    const endDay = Math.min(days, Math.floor((dateValue(end) - dateValue(first)) / 86400000) + 1);
    const dday = dayDiff(item.dueDate);
    const badge = dday === '' ? '' : dday < 0 ? '기한 지남' : dday === 0 ? 'D-day' : `D-${dday}`;
    const taskLines = lines(item);
    const completed = taskLines.filter((_, index) => Boolean(item.done?.[index])).length;
    const progress = taskLines.length ? Math.round((completed / taskLines.length) * 100) : 0;
    const key = courseKey(item.title, item.dueDate);
    const palette = paletteByCourse.get(String(item.title || '과목').trim()) || coursePalette(item.title);
    let cells = `<td class="gantt-subject-col"><strong>${escapeHtml(item.title)}</strong><small>${formatDate(start)} → ${formatDate(end)} · ${progress}%</small></td>`;
    for (let day = 1; day <= days; day += 1) {
      const todayClass = `${monthValue}-${String(day).padStart(2, '0')}` === today ? ' today-cell' : '';
      if (day === startDay && endDay >= startDay) {
        const span = endDay - startDay + 1;
        const state = progress === 100 ? ' is-complete' : progress > 0 ? ' is-progress' : ' is-empty';
        const compact = span <= 2;
        cells += `<td colspan="${span}" class="gantt-cell${todayClass}"><button type="button" class="gantt-bar${state}${compact ? ' is-compact' : ''}" data-course-key="${escapeHtml(key)}" style="--course-bg:${palette.bg};--course-border:${palette.border};--course-soft:${palette.soft};--course-text:${palette.text};--progress:${progress}%" aria-label="${escapeHtml(item.title)} ${progress}% 완료, 진행 현황 보기"><i class="gantt-progress-fill" aria-hidden="true"></i>${compact ? '' : `<span>${escapeHtml(item.title)}</span>`}<span class="gantt-badges"><em>${progress}%</em>${!compact && badge ? `<b>${badge}</b>` : ''}</span></button></td>`;
        day += span - 1;
      } else cells += `<td class="gantt-cell${todayClass}"></td>`;
    }
    return `<tr>${cells}</tr>`;
  }).join('');
  const tableWidth = 170 + (days * 42);
  host.innerHTML = `<table class="gantt-table" style="width:${tableWidth}px;min-width:${tableWidth}px"><colgroup><col class="gantt-subject-column">${Array.from({ length: days }, () => '<col>').join('')}</colgroup><thead><tr><th class="gantt-subject-col">과목</th>${axis}</tr></thead><tbody>${rows}</tbody></table>`;
  host.querySelectorAll('.gantt-bar').forEach(button => {
    button.onclick = () => {
      prepareProgressFocus(button.dataset.courseKey);
      showPage('progress');
    };
  });
  if ($('#overviewPage').classList.contains('active')) scrollGanttToToday();
}
function renderProgressFocus() { const items = allItems(); const tasks = items.flatMap(item => lines(item).map((text, index) => ({ item, text, done: Boolean(item.done?.[index]) }))); const remaining = tasks.filter(task => !task.done); const dueSoon = items.filter(item => { const diff = dayDiff(item.dueDate); return diff !== '' && diff >= 0 && diff <= 3 && lines(item).some((_, index) => !item.done?.[index]); }).length; $('#progressSummary').innerHTML = `<div><span>남은 할 일</span><strong>${remaining.length}</strong></div><div><span>마감 임박</span><strong>${dueSoon}</strong></div><div><span>완료</span><strong>${tasks.length - remaining.length}<small> / ${tasks.length}</small></strong></div>`; const focus = $('#focusList'); if (!remaining.length) { focus.innerHTML = '<div class="focus-empty">오늘은 남은 숙제가 없습니다.</div>'; return; } focus.innerHTML = remaining.sort((a, b) => (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999')).slice(0, 6).map(task => { const diff = dayDiff(task.item.dueDate); const label = diff === '' ? '' : diff === 0 ? 'D-day' : `D-${diff}`; return `<div class="focus-item"><span class="focus-check"></span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.item.title)}</small></div><span>${label}</span></div>`; }).join(''); }
function showRegistered(planData) { savedPlans = planData?.plans || savedPlans; updateMonthPicker(); renderChecklist(); renderProgressFocus(); renderGantt(); }
function setRegisterStep(step, { allowBack = false } = {}) {
  const nextStep = Math.max(1, Math.min(4, step));
  registerStep = allowBack ? nextStep : Math.max(registerStep, nextStep);
  const steps = [...document.querySelectorAll('#registerSteps > div')];
  const lines = [...document.querySelectorAll('#registerSteps > i')];
  steps.forEach((node, index) => { node.classList.toggle('done', index + 1 < registerStep); node.classList.toggle('active', index + 1 === registerStep); });
  lines.forEach((node, index) => node.classList.toggle('done', index + 1 < registerStep));
}
async function refreshStatus() {
  if (statusRefreshPromise) return statusRefreshPromise;
  statusRefreshPromise = (async () => {
    if (!bridge?.epoly) throw new Error('앱 연결을 시작하지 못했습니다. myholypoly를 다시 실행하세요.');
    const status = await bridge.epoly.status();
    $('#connection').className = `connection ${status.connected ? 'online' : 'offline'}`;
    $('#connection').textContent = status.connected ? '연결됨' : status.installed ? '연결 대기' : '미설치';
    $('#connectionCopy').textContent = status.connected ? (status.calendarOpen ? 'e-POLY 캘린더가 열려 있습니다.' : 'e-POLY가 열려 있습니다.') : status.installed ? '연동 모드로 e-POLY를 열어 주세요.' : 'PC 설치 가이드를 보고 e-POLY를 설치한 후 다시 시도해 주세요.';
    $('#epolyInstallHelp').hidden = status.installed;
    $('#launchEpoly').disabled = !status.installed;
    ['#getToday','#openCalendar'].forEach(selector => $(selector).disabled = !status.connected);
    const currentStep = status.calendarOpen ? 3 : status.connected ? 2 : 1;
    const message = $('#importMessage');
    const messageStep = [...document.querySelectorAll('#registerSteps > div')].indexOf(message.parentElement) + 1;
    if (!message.hidden && messageStep > currentStep) setStepMessage(currentStep, '');
    setRegisterStep(currentStep, { allowBack: true });
    return status;
  })();
  try { return await statusRefreshPromise; }
  finally { statusRefreshPromise = null; }
}

let progressScope = overviewScope;
function isVisibleTask(item, done) { if (progressScope === 'all') return true; const due = item.dueDate || item.startDate || item.date; if (progressScope === 'today') return due === today; const week = currentWeekRange(); return !done && due >= week.start && due <= week.end; }
function renderChecklist() { const host = $('#checklistList'); const tasks = allItems().flatMap(item => lines(item).map((text, lineIndex) => ({ item, text, lineIndex, done: Boolean(item.done?.[lineIndex]) }))).filter(task => isVisibleTask(task.item, task.done)); host.innerHTML = ''; $('#taskCount').textContent = `${tasks.filter(task => !task.done).length}개 남음`; if (!tasks.length) { host.innerHTML = '<p class="muted">이 범위에 표시할 할 일이 없습니다.</p>'; return; } tasks.sort((a, b) => (a.done - b.done) || (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999')).forEach(task => { const dday = dayDiff(task.item.dueDate); const dueLabel = dday === '' ? '마감일 없음' : dday < 0 ? '기한 지남' : dday === 0 ? 'D-day' : `D-${dday}`; const row = document.createElement('label'); row.className = `action-task ${task.done ? 'done' : ''}`; row.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}/><span class="task-box"></span><span class="task-body"><small>${escapeHtml(task.item.title)}</small><strong>${escapeHtml(task.text)}</strong></span><span class="task-deadline">${dueLabel}</span>`; host.append(row); row.querySelector('input').onchange = async event => { try { const result = await bridge.plan.toggleLine(task.item.date, task.item.itemIndex, task.lineIndex, event.target.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); event.target.checked = !event.target.checked; } }; }); }
function showRegistered(planData) { savedPlans = planData?.plans || savedPlans; updateMonthPicker(); renderChecklist(); renderGantt(); }
function syncScopeTabs() { $('#scheduleScopeTabs').querySelectorAll('.scope-tab').forEach(tab => { const selected = tab.dataset.scope === overviewScope; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); }); }
function syncHideCompleted() { const button = $('#hideCompleted'); button.classList.toggle('active', hideCompleted); button.setAttribute('aria-pressed', String(hideCompleted)); button.textContent = '완료 항목 숨기기'; }
$('#scheduleScopeTabs').onclick = event => { const button = event.target.closest('.scope-tab'); if (!button) return; overviewScope = button.dataset.scope; progressScope = button.dataset.scope; localStorage.setItem(scopeStorageKey, overviewScope); syncScopeTabs(); renderGantt(); renderChecklist(); };
$('#hideCompleted').onclick = () => { hideCompleted = !hideCompleted; localStorage.setItem(hideCompletedStorageKey, String(hideCompleted)); syncHideCompleted(); renderGantt(); renderChecklist(); };
syncScopeTabs();
syncHideCompleted();
function renderPlanDateControl() {
  const value = $('#planDate').value || today;
  const date = new Date(`${value}T00:00:00`);
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  $('#planDateText').textContent = `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`;
  $('#planDateToday').hidden = value !== today;
}
function movePlanDate(offset) {
  const value = $('#planDate').value || today;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + offset);
  $('#planDate').value = isoDate(date.getFullYear(), date.getMonth(), date.getDate());
  $('#planDate').dispatchEvent(new Event('input', { bubbles: true }));
}
$('#planDate').value = today;
$('#planDate').oninput = renderPlanDateControl;
$('#planDatePrevious').onclick = () => movePlanDate(-1);
$('#planDateNext').onclick = () => movePlanDate(1);
bindDatePicker($('#planDate'), $('#planDateButton'));
renderPlanDateControl();
setCourses([{ title: '', detail: '', dueDate: '' }]);
$('#datePickerPrevious').onclick = event => { event.stopPropagation(); if (datePickerStage === 'months') pickerYear -= 1; else { const date = new Date(pickerYear, pickerMonth - 1, 1); pickerYear = date.getFullYear(); pickerMonth = date.getMonth(); } renderDatePicker(); };
$('#datePickerNext').onclick = event => { event.stopPropagation(); if (datePickerStage === 'months') pickerYear += 1; else { const date = new Date(pickerYear, pickerMonth + 1, 1); pickerYear = date.getFullYear(); pickerMonth = date.getMonth(); } renderDatePicker(); };
$('#datePickerBackToMonths').onclick = event => { event.stopPropagation(); datePickerStage = 'months'; renderDatePicker(); };
$('#datePickerToday').onclick = event => { event.stopPropagation(); if (!activeDateInput) return; activeDateInput.value = today; activeDateInput.dispatchEvent(new Event('input', { bubbles: true })); closeDatePicker(); };
$('#datePickerPopover').onclick = event => event.stopPropagation();
document.addEventListener('click', closeDatePicker);
$('#addTask').onclick = () => { if (courses.length >= maxCourses) { setMessage(`과목은 최대 ${maxCourses}개까지 추가할 수 있습니다.`, true); return setStepMessage(4, `과목은 최대 ${maxCourses}개까지 추가할 수 있습니다.`, 'error'); } courses.push({ title: '', detail: '', originalLines: [''], refinedLines: [false], dueDate: '', startDate: $('#planDate').value }); activeCourseIndex = courses.length - 1; renderCourses(); requestAnimationFrame(() => $('#courseEditor .stacked-course:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); };
$('#compareAllOriginals').onclick = () => {
  const changedIndices = courses.map((course, index) => course.originalLines.join('\n').trim() !== String(course.detail || '').trim() ? index : -1).filter(index => index >= 0);
  const shouldOpen = changedIndices.some(index => !expandedOriginalCourses.has(index));
  expandedOriginalCourses.clear();
  if (shouldOpen) changedIndices.forEach(index => expandedOriginalCourses.add(index));
  renderCourses();
};
$('#launchEpoly').onclick = async () => { setStepMessage(1, 'e-POLY를 실행하고 있습니다.'); try { await bridge.epoly.launch(); setStepMessage(1, 'e-POLY를 실행했습니다.', 'success'); setRegisterStep(2); setMessage('e-POLY를 여는 중입니다.'); setTimeout(() => refreshStatus().catch(error => setStepMessage(1, error.message, 'error')), 1500); } catch (error) { setMessage(error.message, true); setStepMessage(1, error.message, 'error'); } };
$('#openEpolyInstallGuide').onclick = () => bridge.epoly.openInstallGuide();
$('#openCalendar').onclick = async () => { setStepMessage(2, '캘린더를 열고 있습니다.'); try { const result = await bridge.epoly.openCalendar(); if (!result.opened) { setMessage(result.message, true); return setStepMessage(2, result.message, 'error'); } setStepMessage(2, '캘린더를 열었습니다.', 'success'); setRegisterStep(3); setMessage('e-POLY 캘린더를 여는 중입니다.'); setTimeout(() => refreshStatus().catch(error => setStepMessage(2, error.message, 'error')), 1200); } catch (error) { setMessage(error.message, true); setStepMessage(2, error.message, 'error'); } };
$('#getToday').onclick = async () => { const selectedDate = $('#planDate').value; const button = $('#getToday'); setEditingMode(); setRegisterStep(3, { allowBack: true }); setStepMessage(3, `${selectedDate} 일정을 확인하고 있습니다.`); button.disabled = true; try { const isToday = selectedDate === today; const result = isToday ? await bridge.epoly.todayHomework() : await bridge.epoly.dateHomework(selectedDate); source = isToday ? 'epoly-today' : 'epoly-date'; $('#sourceLabel').textContent = isToday ? 'e-POLY 오늘' : `e-POLY ${selectedDate}`; if (!result.tasks.length) { setCourses([{ title: '', detail: '', dueDate: '', startDate: selectedDate }]); setRegisterStep(3, { allowBack: true }); setMessage(''); return setStepMessage(3, `${selectedDate}에 등록된 숙제가 없습니다.`, 'empty'); } let prepared; try { prepared = await organizeImportedCourses(result.tasks); } catch (aiError) { prepared = { items: result.tasks, organized: false }; setMessage(`AI 일정 정리를 적용하지 못해 원본을 불러왔습니다. ${aiError.message}`, true); } setCourses(prepared.items); setRegisterStep(4); if (prepared.organized) { setMessage('AI가 전체 일정을 정리했습니다. 필요하면 원본 보기를 눌러 비교할 수 있습니다.'); setStepMessage(4, `${result.tasks.length}개 과목을 AI로 구성했습니다. 내용을 확인해 주세요.`, 'success'); } else { if (!$('#message').textContent) setMessage(`${selectedDate} 숙제를 가져왔습니다.`); setStepMessage(4, `${result.tasks.length}개 과목을 가져왔습니다. 내용을 확인해 주세요.`, 'success'); } } catch (error) { setCourses([{ title: '', detail: '', dueDate: '', startDate: selectedDate }]); setRegisterStep(3, { allowBack: true }); setMessage(error.message, true); setStepMessage(3, error.message, 'error'); } finally { button.disabled = false; } };
function updateHistoryControls() {
  if ($('#historyBack')) $('#historyBack').disabled = pageHistoryIndex <= 0;
  if ($('#historyForward')) $('#historyForward').disabled = pageHistoryIndex >= pageHistory.length - 1;
}
function scrollGanttToToday() {
  const host = $('#ganttChart');
  if (!host) return;
  const positionToday = () => {
    const todayCell = host.querySelector('.today-col');
    if (!todayCell) {
      host.scrollLeft = 0;
      return;
    }
    const subjectWidth = 170;
    const dateViewportWidth = Math.max(0, host.clientWidth - subjectWidth);
    const targetLeft = todayCell.offsetLeft - subjectWidth - Math.max(0, (dateViewportWidth - todayCell.offsetWidth) / 2);
    const maxLeft = Math.max(0, host.scrollWidth - host.clientWidth);
    host.scrollLeft = Math.min(maxLeft, Math.max(0, targetLeft));
  };
  positionToday();
  requestAnimationFrame(() => {
    positionToday();
    requestAnimationFrame(positionToday);
  });
}
function showPage(page, { record = true } = {}) {
  const currentPage = document.querySelector('.nav-item.active')?.dataset.page;
  if (record && page !== currentPage) {
    pageHistory = pageHistory.slice(0, pageHistoryIndex + 1);
    pageHistory.push(page);
    pageHistoryIndex = pageHistory.length - 1;
  }
  document.querySelectorAll('.nav-item').forEach(button => { const selected = button.dataset.page === page; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); });
  document.querySelectorAll('.app-page').forEach(section => { section.hidden = section.id !== `${page}Page`; section.classList.toggle('active', section.hidden === false); });
  $('#scheduleFilterBar').hidden = page === 'register' || page === 'notes';
  if (page !== 'register' && page !== 'notes') document.querySelector(`#${page}Page .page-title`).insertAdjacentElement('afterend', $('#scheduleFilterBar'));
  if (page === 'overview') { renderGantt(); scrollGanttToToday(); }
  if (page === 'progress') { renderChecklist(); if (focusId) requestAnimationFrame(spotlightSchedule); }
  if (page === 'register') refreshStatus().catch(error => { setMessage(error.message, true); setStepMessage(Math.min(registerStep, 3), error.message, 'error'); });
  if (page === 'notes') renderNotes();
  updateHistoryControls();
}
function goBack() { if (pageHistoryIndex <= 0) return; pageHistoryIndex -= 1; showPage(pageHistory[pageHistoryIndex], { record: false }); }
function goForward() { if (pageHistoryIndex >= pageHistory.length - 1) return; pageHistoryIndex += 1; showPage(pageHistory[pageHistoryIndex], { record: false }); }
$('#register').onclick = async () => { const value = draft(); if (!value.date || !value.items.length) { setMessage('날짜와 과목을 하나 이상 입력하세요.', true); return setStepMessage(4, '날짜와 과목을 하나 이상 입력하세요.', 'error'); } try { if (editingTarget) await bridge.plan.updateItem(editingTarget, value.items[0]); else await bridge.plan.register(value); const wasEditing = Boolean(editingTarget); const registeredFocusKey = courseKey(value.items[0].title, value.items[0].dueDate); const plans = await bridge.plan.read(); setEditingMode(); source = 'manual'; $('#sourceLabel').textContent = '직접 입력'; setCourses([{ title: '', detail: '', dueDate: '', startDate: $('#planDate').value }]); setRegisterStep(1, { allowBack: true }); setStepMessage(4, wasEditing ? '일정을 수정했습니다.' : '일정을 등록했습니다.', 'success'); showRegistered(plans); prepareProgressFocus(registeredFocusKey); showPage('progress'); setMessage(wasEditing ? '일정을 수정했습니다.' : '등록했습니다.'); } catch (error) { setMessage(error.message, true); setStepMessage(4, error.message, 'error'); } };
$('.main-nav').onclick = event => { const button = event.target.closest('.nav-item'); if (button) showPage(button.dataset.page); };
if ($('#historyBack')) $('#historyBack').onclick = goBack;
if ($('#historyForward')) $('#historyForward').onclick = goForward;
window.addEventListener('keydown', event => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); goBack(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); goForward(); }
});
window.addEventListener('auxclick', event => {
  if (event.button === 3) { event.preventDefault(); goBack(); }
  if (event.button === 4) { event.preventDefault(); goForward(); }
});
updateHistoryControls();
const notesStorageKey = 'myholypoly.notes';
let notes = (() => { try { return JSON.parse(localStorage.getItem(notesStorageKey) || '[]'); } catch { return []; } })();
function saveNotes() { localStorage.setItem(notesStorageKey, JSON.stringify(notes)); }
function noteDate(value) { return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function renderNotes() { const host = $('#notesList'); if (!host) return; if (!notes.length) { host.innerHTML = '<div class="notes-empty"><span aria-hidden="true"></span><strong>아직 작성한 메모가 없습니다.</strong><small>오른쪽 위 + 버튼을 눌러 메모를 추가하세요.</small></div>'; return; } host.innerHTML = notes.map(note => `<article class="note-card" data-note-id="${note.id}"><div class="note-card-head"><input data-note-title value="${escapeHtml(note.title)}" placeholder="메모 제목" aria-label="메모 제목"><button type="button" data-delete-note aria-label="메모 삭제">삭제</button></div><textarea data-note-body placeholder="메모 내용을 입력하세요" aria-label="메모 내용">${escapeHtml(note.body)}</textarea><footer>${noteDate(note.updatedAt)}</footer></article>`).join(''); }
function createNote() { const note = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: '', body: '', updatedAt: new Date().toISOString() }; notes.unshift(note); saveNotes(); renderNotes(); requestAnimationFrame(() => $('#notesList [data-note-title]')?.focus()); }
$('#addNote').onclick = createNote;
$('#notesList').onclick = event => { if (event.target.closest('[data-create-note]')) return createNote(); const card = event.target.closest('[data-note-id]'); if (!card || !event.target.closest('[data-delete-note]')) return; notes = notes.filter(note => note.id !== card.dataset.noteId); saveNotes(); renderNotes(); };
$('#notesList').oninput = event => { const card = event.target.closest('[data-note-id]'); if (!card) return; const note = notes.find(item => item.id === card.dataset.noteId); if (!note) return; if (event.target.matches('[data-note-title]')) note.title = event.target.value; if (event.target.matches('[data-note-body]')) note.body = event.target.value; note.updatedAt = new Date().toISOString(); saveNotes(); card.querySelector('footer').textContent = noteDate(note.updatedAt); };
renderNotes();
setInterval(() => {
  if (document.querySelector('.nav-item.active')?.dataset.page !== 'register') return;
  refreshStatus().catch(() => {});
}, 2000);
window.addEventListener('focus', () => {
  if (document.querySelector('.nav-item.active')?.dataset.page === 'register') refreshStatus().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.querySelector('.nav-item.active')?.dataset.page === 'register') refreshStatus().catch(() => {});
});
document.querySelector('#overviewPage .page-title').insertAdjacentElement('afterend', $('#scheduleFilterBar'));
$('#ganttMonth').value = today.slice(0, 7); $('#ganttMonth').onchange = () => { renderGantt(); renderChecklist(); };
let monthPickerYear = Number(today.slice(0, 4));
function updateMonthPicker() {
  const value = $('#ganttMonth').value || today.slice(0, 7);
  const [year, month] = value.split('-').map(Number);
  $('#monthPickerText').textContent = `${year}년 ${month}월`;
  let currentBadge = $('#monthCurrentBadge');
  if (!currentBadge) {
    currentBadge = document.createElement('span');
    currentBadge.id = 'monthCurrentBadge';
    currentBadge.className = 'month-current-badge';
    currentBadge.textContent = '이번 달';
    $('#monthPickerButton').append(currentBadge);
  }
  currentBadge.hidden = value !== today.slice(0, 7);
  $('#monthStripYear').textContent = monthPickerYear;
  const markedMonths = homeworkMonths(monthPickerYear);
  $('#monthGrid').innerHTML = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const selected = year === monthPickerYear && month === number;
    return `<button type="button" data-month="${number}" class="${selected ? 'selected' : ''}">${number}월${markedMonths.has(number) ? '<i></i>' : ''}</button>`;
  }).join('');
  $('#monthGrid').querySelectorAll('button').forEach(button => button.onclick = () => {
    $('#ganttMonth').value = `${monthPickerYear}-${String(button.dataset.month).padStart(2, '0')}`;
    $('#monthPopover').hidden = true;
    $('#monthPickerButton').setAttribute('aria-expanded', 'false');
    updateMonthPicker();
    renderGantt(); renderChecklist();
  });
}
function moveGanttMonth(offset) {
  const [year, month] = ($('#ganttMonth').value || today.slice(0, 7)).split('-').map(Number);
  const target = new Date(year, month - 1 + offset, 1);
  $('#ganttMonth').value = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
  monthPickerYear = target.getFullYear();
  updateMonthPicker();
  renderGantt(); renderChecklist();
}
function positionMonthPopover() {
  const button = $('#monthPickerButton'); const popover = $('#monthPopover');
  if (!button || !popover || popover.hidden) return;
  const rect = button.getBoundingClientRect(); const gap = 10; const edge = 12;
  const left = Math.max(edge, Math.min(rect.left, window.innerWidth - popover.offsetWidth - edge));
  const top = Math.max(edge, Math.min(rect.bottom + gap, window.innerHeight - popover.offsetHeight - edge));
  popover.style.left = `${Math.round(left)}px`; popover.style.top = `${Math.round(top)}px`;
}
$('#monthQuickPrevious').onclick = event => { event.stopPropagation(); moveGanttMonth(-1); };
$('#monthQuickNext').onclick = event => { event.stopPropagation(); moveGanttMonth(1); };
$('#monthPickerButton').onclick = event => { event.stopPropagation(); const popover = $('#monthPopover'); const opening = popover.hidden; popover.hidden = !opening; $('#monthPickerButton').setAttribute('aria-expanded', String(opening)); if (opening) { monthPickerYear = Number(($('#ganttMonth').value || today).slice(0, 4)); updateMonthPicker(); positionMonthPopover(); } };
$('#monthPopover').onclick = event => event.stopPropagation();
$('#monthToday').onclick = () => { $('#ganttMonth').value = today.slice(0, 7); monthPickerYear = Number(today.slice(0, 4)); $('#monthPopover').hidden = true; $('#monthPickerButton').setAttribute('aria-expanded', 'false'); updateMonthPicker(); renderGantt(); renderChecklist(); };
$('#monthYearPrevious').onclick = () => { monthPickerYear -= 1; updateMonthPicker(); };
$('#monthYearNext').onclick = () => { monthPickerYear += 1; updateMonthPicker(); };
document.addEventListener('click', () => { $('#monthPopover').hidden = true; $('#monthPickerButton').setAttribute('aria-expanded', 'false'); });
window.addEventListener('resize', positionMonthPopover);
updateMonthPicker();
progressScope = overviewScope;
function isVisibleTask(item, done) { const monthValue = $('#ganttMonth').value || today.slice(0, 7); const [year, month] = monthValue.split('-').map(Number); const first = `${monthValue}-01`; const last = `${monthValue}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`; const start = item.startDate || item.date; const due = item.dueDate || start; if (start > last || due < first || (hideCompleted && done)) return false; const diff = dayDiff(due); if (progressScope === 'all') return true; if (progressScope === 'urgent') return diff !== '' && diff >= 0 && diff <= 3; if (progressScope === 'today') return due === today; const week = currentWeekRange(); return due >= week.start && due <= week.end; }
function renderSidebarSummary() { const monthValue = $('#ganttMonth').value || today.slice(0, 7); const items = allItems().filter(item => { const start = item.startDate || item.date; const due = item.dueDate || start; return start?.startsWith(monthValue) || due?.startsWith(monthValue); }); const tasks = items.flatMap(item => lines(item).map((_, index) => ({ done: Boolean(item.done?.[index]), dueDate: item.dueDate }))); const done = tasks.filter(task => task.done).length; const remaining = tasks.length - done; const rate = tasks.length ? Math.round(done / tasks.length * 100) : 0; const badge = $('#progressNavBadge'); if (badge) { badge.textContent = String(remaining); badge.hidden = remaining === 0; } if ($('#overviewCompletionRate')) $('#overviewCompletionRate').textContent = `${rate}%`; if ($('#overviewCompletionBar')) $('#overviewCompletionBar').style.width = `${rate}%`; }
function renderChecklist() { const host = $('#checklistList'); const tasks = allItems().flatMap(item => lines(item).map((text, lineIndex) => ({ item, text, lineIndex, done: Boolean(item.done?.[lineIndex]) }))).filter(task => isVisibleTask(task.item, task.done)); host.innerHTML = ''; $('#taskCount').textContent = progressScope === 'urgent' ? `3일 이내 · ${tasks.length}개` : `${tasks.filter(task => !task.done).length}개 남음`; if (!tasks.length) { host.innerHTML = progressScope === 'urgent' ? '<p class="muted">3일 이내 마감인 미완료 할 일이 없습니다.</p>' : '<p class="muted">이 범위에 표시할 할 일이 없습니다.</p>'; return; } tasks.sort((a, b) => (a.done - b.done) || (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999')).forEach(task => { const diff = dayDiff(task.item.dueDate); const dueLabel = diff === '' ? '마감일 없음' : diff < 0 ? '기한 지남' : diff === 0 ? 'D-day' : `D-${diff}`; const urgency = !task.done && diff !== '' && diff <= 1 ? 'critical' : !task.done && diff !== '' && diff <= 3 ? 'soon' : ''; const row = document.createElement('label'); row.className = `action-task ${task.done ? 'done' : ''} ${urgency}`; row.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}/><span class="task-box"></span><span class="task-body"><small>${escapeHtml(task.item.title)}</small><strong>${escapeHtml(task.text)}</strong></span><span class="task-deadline">${dueLabel}</span>`; host.append(row); row.querySelector('input').onchange = async event => { try { const result = await bridge.plan.toggleLine(task.item.date, task.item.itemIndex, task.lineIndex, event.target.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); event.target.checked = !event.target.checked; } }; }); }
function courseTargets(course) { return [...new Map(course.tasks.map(task => [`${task.item.date}:${task.item.itemIndex}`, { date: task.item.date, itemIndex: task.item.itemIndex }])).values()]; }
function editSchedule(course) {
  const completeTasks = allItems()
    .filter(item => courseKey(item.title, item.dueDate) === course.key)
    .flatMap(item => lines(item).map((text, lineIndex) => ({ item, text, lineIndex, done: Boolean(item.done?.[lineIndex]) })));
  inlineCourseDraft = {
    key: course.key,
    title: course.title,
    dueDate: course.dueDate || '',
    tasks: completeTasks
  };
  closeScheduleMenus();
  renderChecklist();
  requestAnimationFrame(() => document.querySelector('.action-course.is-editing input')?.focus());
}
async function saveInlineSchedule(course) {
  const title = inlineCourseDraft.title.trim();
  const taskTexts = inlineCourseDraft.tasks.map(task => task.text.trim()).filter(Boolean);
  if (!title) return setMessage('과목 이름을 입력하세요.', true);
  if (!taskTexts.length) return setMessage('내용을 하나 이상 입력하세요.', true);
  try {
    const nextDueDate = inlineCourseDraft.dueDate;
    for (const target of courseTargets({ tasks: inlineCourseDraft.tasks })) {
      const original = inlineCourseDraft.tasks.find(task => task.item.date === target.date && task.item.itemIndex === target.itemIndex)?.item;
      const tasks = inlineCourseDraft.tasks.filter(task => task.item.date === target.date && task.item.itemIndex === target.itemIndex && task.text.trim());
      const result = await bridge.plan.updateItem(target, {
        title,
        dueDate: inlineCourseDraft.dueDate,
        startDate: original?.startDate || target.date,
        detail: tasks.map(task => task.text.trim()).join('\n'),
        done: tasks.map(task => Boolean(task.done))
      });
      savedPlans = result.plans;
    }
    inlineCourseDraft = null;
    selectedCourseKey = courseKey(title, nextDueDate);
    setMessage('일정을 수정했습니다.');
    renderChecklist();
    renderGantt();
  } catch (error) { setMessage(error.message, true); }
}
async function deleteSchedule(course) {
  if (!window.confirm(`'${course.title}' 일정을 삭제할까요?`)) return;
  try {
    const result = await bridge.plan.deleteItems(courseTargets(course));
    savedPlans = result.plans;
    if (selectedCourseKey === course.key) selectedCourseKey = '';
    renderChecklist(); renderGantt();
  } catch (error) { setMessage(error.message, true); }
}
function closeScheduleMenus() { document.querySelectorAll('.schedule-menu.open').forEach(menu => menu.classList.remove('open')); document.querySelectorAll('.schedule-more[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false')); }
function spotlightSchedule() {
  if (!focusId) return;
  const activeFocusId = focusId;
  const wrapper = [...document.querySelectorAll('.spot-wrap[data-schedule-id]')].find(node => node.dataset.scheduleId === activeFocusId);
  focusId = '';
  if (!wrapper) return;
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    wrapper.classList.remove('spotlight');
    void wrapper.offsetWidth;
    wrapper.classList.add('spotlight');
    const done = event => {
      if (event.animationName !== 'spot-pop') return;
      wrapper.classList.remove('spotlight');
      wrapper.removeEventListener('animationend', done);
    };
    wrapper.addEventListener('animationend', done);
  }, 350);
}
document.addEventListener('click', closeScheduleMenus);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openMenu = document.querySelector('.schedule-menu.open');
  if (!openMenu) return;
  event.preventDefault();
  event.stopPropagation();
  const trigger = openMenu.closest('.schedule-actions')?.querySelector('.schedule-more');
  closeScheduleMenus();
  trigger?.blur();
});
function renderChecklist() {
  renderSidebarSummary();
  const host = $('#checklistList');
  const groups = new Map();
  allItems().forEach(item => lines(item).forEach((text, lineIndex) => {
    const done = Boolean(item.done?.[lineIndex]);
    if (!isVisibleTask(item, done)) return;
    const key = courseKey(item.title, item.dueDate);
    if (!groups.has(key)) groups.set(key, { key, title: item.title, startDate: item.startDate || item.date, dueDate: item.dueDate, tasks: [] });
    groups.get(key).tasks.push({ item, text, lineIndex, done });
  }));
  const courses = [...groups.values()].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  host.innerHTML = '';
  $('#taskCount').textContent = `${courses.reduce((count, course) => count + course.tasks.filter(task => !task.done).length, 0)}개`;
  if (!courses.length) { host.innerHTML = progressScope === 'urgent' ? '<p class="muted">3일 이내 마감인 미완료 할 일이 없습니다.</p>' : '<p class="muted">이 범위에 표시할 할 일이 없습니다.</p>'; return; }
  courses.forEach(course => {
    const diff = dayDiff(course.dueDate);
    const allComplete = course.tasks.length > 0 && course.tasks.every(task => task.done);
    const dueLabel = allComplete ? '완료' : diff === '' ? '마감일 없음' : diff < 0 ? '기한 지남' : diff === 0 ? 'D-day' : `D-${diff}`;
    const urgency = allComplete ? '' : diff !== '' && diff <= 1 ? 'critical' : diff !== '' && diff <= 3 ? 'soon' : '';
    const palette = coursePalette(course.title);
    const card = document.createElement('article');
    const editing = inlineCourseDraft?.key === course.key;
    card.className = `action-course ${urgency} ${allComplete ? 'is-complete' : ''} ${course.key === selectedCourseKey ? 'is-target' : ''} ${editing ? 'is-editing' : ''}`;
    card.dataset.courseKey = course.key;
    card.style.setProperty('--course-bg', palette.bg); card.style.setProperty('--course-border', palette.border); card.style.setProperty('--course-soft', palette.soft); card.style.setProperty('--course-text', palette.text);
    card.innerHTML = editing
      ? `<div class="inline-course-editor"><div class="inline-editor-title"><strong>${escapeHtml(course.title)}</strong><small>할 일 내용 편집</small></div><div class="inline-course-tasks">${inlineCourseDraft.tasks.map((task, index) => `<div><span>${String(index + 1).padStart(2, '0')}</span><input data-inline-task="${index}" value="${escapeHtml(task.text)}"><button type="button" data-inline-remove="${index}" aria-label="내용 삭제">삭제</button></div>`).join('')}</div><button type="button" class="inline-add-task">＋ 내용 추가</button><div class="inline-editor-actions"><button type="button" class="inline-cancel">취소</button><button type="button" class="inline-save">수정 저장</button></div></div>`
      : `<header><div><span class="course-dot"></span><strong>${escapeHtml(course.title)}</strong><small>시작 ${formatDate(course.startDate)} · 마감 ${formatDate(course.dueDate)}</small></div><div class="action-course-meta"><span class="task-deadline">${dueLabel}</span><div class="schedule-actions"><button type="button" class="schedule-more" aria-label="일정 메뉴" aria-expanded="false">•••</button><div class="schedule-menu"><button type="button" data-edit-schedule><img src="./icons/icon-edit.svg" alt="">일정 수정</button><span class="schedule-menu-separator" aria-hidden="true"></span><button type="button" data-delete-schedule><img src="./icons/icon-delete.svg" alt="">일정 삭제</button></div></div></div></header><div class="action-course-tasks">${course.tasks.map(task => `<label class="action-course-line ${task.done ? 'done' : ''}"><input type="checkbox" ${task.done ? 'checked' : ''}/><span class="task-box"></span><span>${escapeHtml(task.text)}</span></label>`).join('')}</div><footer>${hideCompleted ? `${course.tasks.length}개 남음` : `${course.tasks.filter(task => task.done).length}/${course.tasks.length} 완료`}</footer>`;
    const wrapper = document.createElement('div');
    wrapper.className = 'spot-wrap';
    wrapper.dataset.scheduleId = course.key;
    wrapper.append(card);
    host.append(wrapper);
    if (editing) {
      card.querySelectorAll('[data-inline-task]').forEach(input => input.oninput = event => { inlineCourseDraft.tasks[Number(event.target.dataset.inlineTask)].text = event.target.value; });
      card.querySelectorAll('[data-inline-remove]').forEach(button => button.onclick = () => { if (inlineCourseDraft.tasks.length === 1) return setMessage('내용을 하나 이상 남겨 주세요.', true); inlineCourseDraft.tasks.splice(Number(button.dataset.inlineRemove), 1); renderChecklist(); });
      card.querySelector('.inline-add-task').onclick = () => { const template = inlineCourseDraft.tasks[0]; inlineCourseDraft.tasks.push({ ...template, text: '', done: false, lineIndex: -1 }); renderChecklist(); requestAnimationFrame(() => { const inputs = document.querySelectorAll('.action-course.is-editing [data-inline-task]'); inputs[inputs.length - 1]?.focus(); }); };
      card.querySelector('.inline-cancel').onclick = () => { inlineCourseDraft = null; setMessage(''); renderChecklist(); };
      card.querySelector('.inline-save').onclick = () => saveInlineSchedule(course);
      return;
    }
    card.querySelectorAll('input').forEach((input, index) => input.onchange = async event => { const task = course.tasks[index]; try { const result = await bridge.plan.toggleLine(task.item.date, task.item.itemIndex, task.lineIndex, event.target.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); event.target.checked = !event.target.checked; } });
    const menu = card.querySelector('.schedule-menu');
    const more = card.querySelector('.schedule-more');
    more.onclick = event => { event.stopPropagation(); const opening = !menu.classList.contains('open'); closeScheduleMenus(); menu.classList.toggle('open', opening); more.setAttribute('aria-expanded', String(opening)); };
    card.querySelector('[data-edit-schedule]').onclick = event => { event.stopPropagation(); editSchedule(course); };
    card.querySelector('[data-delete-schedule]').onclick = event => { event.stopPropagation(); deleteSchedule(course); };
  });
}
(async () => { try { await refreshStatus(); showRegistered(await bridge.plan.read()); } catch (error) { setMessage(error.message, true); } })();
