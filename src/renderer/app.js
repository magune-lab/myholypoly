const $ = selector => document.querySelector(selector);
const now = new Date();
const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const bridge = window.myholypoly;
$('#closeApp').onclick = () => window.close();
async function toggleMaximize() {
  const maximized = await bridge.windowControls.toggleMaximize();
  document.body.classList.toggle('is-maximized', maximized);
  $('#maximizeApp').textContent = maximized ? '❐' : '□';
  $('#maximizeApp').title = maximized ? '이전 크기로 복원' : '최대화';
  $('#maximizeApp').setAttribute('aria-label', maximized ? '창 이전 크기' : '창 최대화');
}
$('#maximizeApp').onclick = toggleMaximize;
document.querySelector('.brand').ondblclick = toggleMaximize;
let source = 'manual';
let courses = [];
let activeCourseIndex = 0;
let editingTarget = null;
let savedPlans = {};
let selectedCourseKey = '';
let pageHistory = ['overview'];
let pageHistoryIndex = 0;
const scopeStorageKey = 'myholypoly.scheduleScope';
const validScopes = ['urgent', 'today', 'week', 'all'];
const storedScope = localStorage.getItem(scopeStorageKey);
let overviewScope = validScopes.includes(storedScope) ? storedScope : 'all';
let registerStep = 1;
const lines = course => String(course.detail || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const escapeHtml = value => { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; };
const coursePalettes = [
  { bg: '#DB5A8B', border: '#C94173', soft: '#FBEAF1', text: '#A93260' },
  { bg: '#35A77B', border: '#278E68', soft: '#E7F6F0', text: '#247D5D' },
  { bg: '#5578D8', border: '#4265C3', soft: '#EAF0FC', text: '#355AB8' },
  { bg: '#7B5CE5', border: '#6748D2', soft: '#F0ECFD', text: '#6042CA' },
  { bg: '#DEA13C', border: '#BF8124', soft: '#FFF4D9', text: '#916018' },
  { bg: '#E66F55', border: '#CF5941', soft: '#FDEDE8', text: '#B54A35' },
  { bg: '#2797B8', border: '#1C819F', soft: '#E6F5F9', text: '#1D748D' },
  { bg: '#8A6B4E', border: '#74563C', soft: '#F5EEE8', text: '#684A33' },
  { bg: '#7A9E36', border: '#63852A', soft: '#F0F6E4', text: '#577525' },
  { bg: '#B365C5', border: '#994EAC', soft: '#F7EBFA', text: '#874299' }
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
function isoDate(year, month, day) { return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function renderDatePicker() {
  $('#datePickerYearSelect').innerHTML = Array.from({ length: 11 }, (_, index) => pickerYear - 5 + index).map(year => `<option value="${year}">${year}년</option>`).join('');
  $('#datePickerYearSelect').value = String(pickerYear);
  $('#datePickerMonthSelect').innerHTML = Array.from({ length: 12 }, (_, index) => `<option value="${index}">${index + 1}월</option>`).join('');
  $('#datePickerMonthSelect').value = String(pickerMonth);
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
    cells.push(`<button type="button" data-date="${value}" class="${outside ? 'outside' : ''} ${value === selected ? 'selected' : ''} ${value === today ? 'today' : ''}">${day}</button>`);
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
function openDatePicker(input) {
  activeDateInput = input;
  const value = input.value ? new Date(`${input.value}T00:00:00`) : new Date();
  pickerYear = value.getFullYear(); pickerMonth = value.getMonth();
  renderDatePicker();
  const popover = $('#datePickerPopover');
  popover.hidden = false;
  const rect = input.getBoundingClientRect();
  const width = 276;
  popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  popover.style.top = `${Math.min(rect.bottom + 7, window.innerHeight - 342)}px`;
}
function closeDatePicker() { $('#datePickerPopover').hidden = true; activeDateInput = null; }
function bindDatePicker(input) { input.onclick = event => { event.stopPropagation(); openDatePicker(input); }; input.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDatePicker(input); } if (event.key === 'Escape') closeDatePicker(); }; }
function setMessage(message, isError = false) { const node = $('#message'); node.textContent = String(message || '').replace(/^Error invoking remote method '[^']+': Error:\s*/i, ''); node.classList.toggle('error', isError); }
function setImportMessage(message = '', type = 'info') { const node = $('#importMessage'); if (!node) return; const text = String(message || '').replace(/^Error invoking remote method '[^']+': Error:\s*/i, ''); node.hidden = !text; node.textContent = text ? `${type === 'error' ? '!' : type === 'success' ? '✓' : 'i'}  ${text}` : ''; node.dataset.type = type; }
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
    return `<article class="stacked-course ${courseIndex === activeCourseIndex ? 'active' : ''}" data-course="${courseIndex}"><div class="stacked-course-head"><span class="course-number">${String(courseIndex + 1).padStart(2, '0')}</span><input data-course-title="${courseIndex}" value="${escapeHtml(course.title)}" placeholder="과목 이름" aria-label="${courseIndex + 1}번째 과목 이름"><label>마감일 <input data-course-due="${courseIndex}" class="custom-date-input" type="text" readonly value="${escapeHtml(course.dueDate)}" aria-label="${courseIndex + 1}번째 과목 마감일"></label></div><div class="focus-course-lines">${itemLines.map((line, lineIndex) => `<label class="focus-course-line"><span>${String(lineIndex + 1).padStart(2, '0')}</span><input data-course-line="${courseIndex}" data-line="${lineIndex}" value="${escapeHtml(line)}" placeholder="할 일"><button type="button" data-remove-line="${courseIndex}:${lineIndex}" aria-label="항목 삭제">삭제</button></label>`).join('')}</div><button class="add-focus-line" data-add-line="${courseIndex}" type="button">＋ 내용 추가</button></article>`;
  }).join('');
  const selectCourse = index => { activeCourseIndex = index; editor.querySelectorAll('.stacked-course').forEach((card, cardIndex) => card.classList.toggle('active', cardIndex === index)); };
  editor.querySelectorAll('.stacked-course').forEach((card, index) => card.onclick = () => selectCourse(index));
  editor.querySelectorAll('[data-course-title]').forEach(input => input.oninput = event => { const index = Number(event.target.dataset.courseTitle); courses[index].title = event.target.value; selectCourse(index); });
  editor.querySelectorAll('[data-course-due]').forEach(input => { input.oninput = event => { const index = Number(event.target.dataset.courseDue); courses[index].dueDate = event.target.value; selectCourse(index); }; bindDatePicker(input); });
  editor.querySelectorAll('[data-course-line]').forEach(input => input.oninput = event => { const index = Number(event.target.dataset.courseLine); const card = event.target.closest('.stacked-course'); courses[index].detail = [...card.querySelectorAll('[data-course-line]')].map(node => node.value).join('\n'); selectCourse(index); });
  editor.querySelectorAll('[data-remove-line]').forEach(button => button.onclick = event => { event.stopPropagation(); const [courseIndex, lineIndex] = button.dataset.removeLine.split(':').map(Number); const card = button.closest('.stacked-course'); const values = [...card.querySelectorAll('[data-course-line]')].map(node => node.value); values.splice(lineIndex, 1); courses[courseIndex].detail = values.join('\n'); activeCourseIndex = courseIndex; renderCourses(); });
  editor.querySelectorAll('[data-add-line]').forEach(button => button.onclick = event => { event.stopPropagation(); const index = Number(button.dataset.addLine); const course = courses[index]; course.detail = `${course.detail}${course.detail ? '\n' : ''}새 항목`; activeCourseIndex = index; renderCourses(); const card = editor.querySelector(`[data-course="${index}"]`); const inputs = card.querySelectorAll('[data-course-line]'); inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); });
  $('#deleteCourse').onclick = () => { courses.splice(activeCourseIndex, 1); activeCourseIndex = Math.max(0, activeCourseIndex - 1); renderCourses(); };
}
function setCourses(items) { courses = items.map(item => ({ title: item.title || '', detail: item.detail || '', dueDate: item.dueDate || '', startDate: item.startDate || '' })); activeCourseIndex = 0; renderCourses(); }
function draft() { return { date: $('#planDate').value, source, items: courses.filter(course => course.title).map(course => ({ title: course.title, detail: course.detail, dueDate: course.dueDate, startDate: course.startDate || $('#planDate').value })) }; }
function setEditingMode(target = null) { editingTarget = target; const editing = Boolean(target); $('#addTask').hidden = editing; $('#deleteCourse').hidden = editing; $('#planDate').disabled = editing; $('#register').textContent = editing ? '수정 저장' : '일정 등록'; }
const dateValue = value => value ? new Date(`${value}T00:00:00`) : null;
const formatDate = value => value ? value.slice(5).replace('-', '.') : '마감일 없음';
const dayDiff = value => { const target = dateValue(value); if (!target) return ''; return Math.ceil((target - new Date(today + 'T00:00:00')) / 86400000); };
function allItems() { return Object.entries(savedPlans).flatMap(([date, plan]) => (plan.items || []).map((item, itemIndex) => ({ ...item, date, itemIndex, startDate: item.startDate || date }))).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')); }
function renderChecklist() { const host = $('#checklistList'); const items = allItems(); host.innerHTML = ''; if (!items.length) { host.innerHTML = '<p class="muted">등록된 일정이 없습니다.</p>'; return; } items.forEach(item => { const itemLines = lines(item); const done = item.done || []; const remaining = itemLines.filter((_, index) => !done[index]).length; const dday = dayDiff(item.dueDate); const badge = dday === '' ? '' : dday < 0 ? '기한 지남' : dday === 0 ? 'D-day' : `D-${dday}`; const card = document.createElement('article'); card.className = 'check-course'; card.innerHTML = `<header><div><span class="course-dot"></span><strong>${escapeHtml(item.title)}</strong><small>시작일 ${formatDate(item.startDate)} · 마감 ${formatDate(item.dueDate)}</small></div><span class="deadline ${dday < 0 ? 'late' : ''}">${badge}</span></header><div class="check-lines">${itemLines.map((line, lineIndex) => `<label><input type="checkbox" data-date="${item.date}" data-item="${item.itemIndex}" data-line="${lineIndex}" ${done[lineIndex] ? 'checked' : ''}/><span>${escapeHtml(line)}</span></label>`).join('') || '<p class="muted">내용이 없습니다.</p>'}</div><footer>${itemLines.length - remaining}/${itemLines.length} 완료</footer>`; host.append(card); }); host.querySelectorAll('input[type=checkbox]').forEach(input => input.onchange = async () => { try { const result = await bridge.plan.toggleLine(input.dataset.date, Number(input.dataset.item), Number(input.dataset.line), input.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); input.checked = !input.checked; } }); }
function renderGantt() {
  const host = $('#ganttChart');
  const monthValue = $('#ganttMonth').value || today.slice(0, 7);
  const [year, month] = monthValue.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const first = `${monthValue}-01`;
  const last = `${monthValue}-${String(days).padStart(2, '0')}`;
  const monthItems = allItems().filter(item => (item.startDate || item.date) <= last && (item.dueDate || item.startDate || item.date) >= first);
  const items = monthItems.filter(item => {
    if (overviewScope === 'all') return true;
    const taskLines = lines(item);
    const hasRemaining = taskLines.some((_, index) => !item.done?.[index]);
    if (!hasRemaining) return false;
    const due = item.dueDate || item.startDate || item.date;
    const diff = dayDiff(due);
    if (overviewScope === 'urgent') return diff !== '' && diff <= 3;
    if (overviewScope === 'today') return due === today || item.startDate === today;
    const weekEnd = new Date(`${today}T00:00:00`);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return due <= weekEnd.toISOString().slice(0, 10);
  });
  const paletteByCourse = coursePaletteMap(items);
  $('#ganttCount').textContent = overviewScope === 'urgent' ? `3일 이내 · ${items.length}개` : `${items.length}개 일정`;
  if (!items.length) { host.innerHTML = `<p class="muted">${overviewScope === 'all' ? '이 달에 표시할 일정이 없습니다.' : '선택한 범위에 남은 일정이 없습니다.'}</p>`; return; }
  const axis = Array.from({ length: days }, (_, index) => {
    const value = `${monthValue}-${String(index + 1).padStart(2, '0')}`;
    return `<th class="day-col ${value === today ? 'today-col' : ''}">${index + 1}</th>`;
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
  host.innerHTML = `<table class="gantt-table"><thead><tr><th class="gantt-subject-col">과목</th>${axis}</tr></thead><tbody>${rows}</tbody></table>`;
  host.querySelectorAll('.gantt-bar').forEach(button => {
    button.onclick = () => {
      selectedCourseKey = button.dataset.courseKey;
      showPage('progress');
      requestAnimationFrame(() => {
        const page = $('#progressPage');
        const target = page.querySelector('.action-course.is-target');
        if (!target) return;
        const pageRect = page.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const nextTop = page.scrollTop + targetRect.top - pageRect.top - Math.max(20, (page.clientHeight - targetRect.height) / 2);
        page.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
      });
    };
  });
  if ($('#overviewPage').classList.contains('active')) scrollGanttToToday();
}
function renderProgressFocus() { const items = allItems(); const tasks = items.flatMap(item => lines(item).map((text, index) => ({ item, text, done: Boolean(item.done?.[index]) }))); const remaining = tasks.filter(task => !task.done); const dueSoon = items.filter(item => { const diff = dayDiff(item.dueDate); return diff !== '' && diff >= 0 && diff <= 3 && lines(item).some((_, index) => !item.done?.[index]); }).length; $('#progressSummary').innerHTML = `<div><span>남은 할 일</span><strong>${remaining.length}</strong></div><div><span>마감 임박</span><strong>${dueSoon}</strong></div><div><span>완료</span><strong>${tasks.length - remaining.length}<small> / ${tasks.length}</small></strong></div>`; const focus = $('#focusList'); if (!remaining.length) { focus.innerHTML = '<div class="focus-empty">오늘은 남은 숙제가 없습니다.</div>'; return; } focus.innerHTML = remaining.sort((a, b) => (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999')).slice(0, 6).map(task => { const diff = dayDiff(task.item.dueDate); const label = diff === '' ? '' : diff === 0 ? 'D-day' : `D-${diff}`; return `<div class="focus-item"><span class="focus-check"></span><div><strong>${escapeHtml(task.text)}</strong><small>${escapeHtml(task.item.title)}</small></div><span>${label}</span></div>`; }).join(''); }
function showRegistered(planData) { savedPlans = planData?.plans || savedPlans; renderChecklist(); renderProgressFocus(); renderGantt(); }
function setRegisterStep(step, { allowBack = false } = {}) {
  const nextStep = Math.max(1, Math.min(4, step));
  registerStep = allowBack ? nextStep : Math.max(registerStep, nextStep);
  const steps = [...document.querySelectorAll('#registerSteps > div')];
  const lines = [...document.querySelectorAll('#registerSteps > i')];
  steps.forEach((node, index) => { node.classList.toggle('done', index + 1 < registerStep); node.classList.toggle('active', index + 1 === registerStep); });
  lines.forEach((node, index) => node.classList.toggle('done', index + 1 < registerStep));
}
async function refreshStatus() { if (!bridge?.epoly) throw new Error('앱 연결을 시작하지 못했습니다. myholypoly를 다시 실행하세요.'); const status = await bridge.epoly.status(); $('#connection').className = `connection ${status.connected ? 'online' : 'offline'}`; $('#connection').textContent = status.connected ? '연결됨' : status.installed ? '연결 대기' : '미설치'; $('#connectionCopy').textContent = status.connected ? (status.calendarOpen ? 'e-POLY 캘린더가 열려 있습니다.' : 'e-POLY가 열려 있습니다.') : '연동 모드로 e-POLY를 열어 주세요.'; ['#getToday','#openCalendar'].forEach(selector => $(selector).disabled = !status.connected); if (status.calendarOpen) setRegisterStep(3); else if (status.connected) setRegisterStep(2); }

let progressScope = overviewScope;
function isVisibleTask(item, done) { if (progressScope === 'all') return true; const due = item.dueDate || item.startDate || item.date; if (progressScope === 'today') return due <= today || item.startDate === today; const weekEnd = new Date(`${today}T00:00:00`); weekEnd.setDate(weekEnd.getDate() + 6); const end = weekEnd.toISOString().slice(0, 10); return due <= end || !done && due < today; }
function renderChecklist() { const host = $('#checklistList'); const tasks = allItems().flatMap(item => lines(item).map((text, lineIndex) => ({ item, text, lineIndex, done: Boolean(item.done?.[lineIndex]) }))).filter(task => isVisibleTask(task.item, task.done)); host.innerHTML = ''; $('#taskCount').textContent = `${tasks.filter(task => !task.done).length}개 남음`; if (!tasks.length) { host.innerHTML = '<p class="muted">이 범위에 표시할 할 일이 없습니다.</p>'; return; } tasks.sort((a, b) => (a.done - b.done) || (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999')).forEach(task => { const dday = dayDiff(task.item.dueDate); const dueLabel = dday === '' ? '마감일 없음' : dday < 0 ? '기한 지남' : dday === 0 ? 'D-day' : `D-${dday}`; const row = document.createElement('label'); row.className = `action-task ${task.done ? 'done' : ''}`; row.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}/><span class="task-box"></span><span class="task-body"><small>${escapeHtml(task.item.title)}</small><strong>${escapeHtml(task.text)}</strong></span><span class="task-deadline">${dueLabel}</span>`; host.append(row); row.querySelector('input').onchange = async event => { try { const result = await bridge.plan.toggleLine(task.item.date, task.item.itemIndex, task.lineIndex, event.target.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); event.target.checked = !event.target.checked; } }; }); }
function showRegistered(planData) { savedPlans = planData?.plans || savedPlans; renderChecklist(); renderGantt(); }
function syncScopeTabs() { $('#scheduleScopeTabs').querySelectorAll('.scope-tab').forEach(tab => { const selected = tab.dataset.scope === overviewScope; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); }); }
$('#scheduleScopeTabs').onclick = event => { const button = event.target.closest('.scope-tab'); if (!button) return; overviewScope = button.dataset.scope; progressScope = button.dataset.scope; localStorage.setItem(scopeStorageKey, overviewScope); syncScopeTabs(); renderGantt(); renderChecklist(); };
syncScopeTabs();
$('#planDate').value = today; setCourses([{ title: '', detail: '', dueDate: '' }]);
bindDatePicker($('#planDate'));
$('#datePickerYearSelect').onchange = event => { event.stopPropagation(); pickerYear = Number(event.target.value); renderDatePicker(); };
$('#datePickerMonthSelect').onchange = event => { event.stopPropagation(); pickerMonth = Number(event.target.value); renderDatePicker(); };
$('#datePickerToday').onclick = event => { event.stopPropagation(); if (!activeDateInput) return; activeDateInput.value = today; activeDateInput.dispatchEvent(new Event('input', { bubbles: true })); closeDatePicker(); };
$('#datePickerClear').onclick = event => { event.stopPropagation(); if (!activeDateInput) return; activeDateInput.value = ''; activeDateInput.dispatchEvent(new Event('input', { bubbles: true })); closeDatePicker(); };
$('#datePickerPopover').onclick = event => event.stopPropagation();
document.addEventListener('click', closeDatePicker);
$('#addTask').onclick = () => { if (courses.length >= 3) return setMessage('과목은 최대 3개까지 추가할 수 있습니다.', true); courses.push({ title: '', detail: '', dueDate: '', startDate: $('#planDate').value }); activeCourseIndex = courses.length - 1; renderCourses(); requestAnimationFrame(() => $('#courseEditor .stacked-course:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); };
$('#launchEpoly').onclick = async () => { try { await bridge.epoly.launch(); setRegisterStep(2); setMessage('e-POLY를 여는 중입니다.'); setTimeout(refreshStatus, 1500); } catch (error) { setMessage(error.message, true); } };
$('#openCalendar').onclick = async () => { try { const result = await bridge.epoly.openCalendar(); if (!result.opened) return setMessage(result.message, true); setRegisterStep(3); setMessage('e-POLY 캘린더를 여는 중입니다.'); setTimeout(refreshStatus, 1200); } catch (error) { setMessage(error.message, true); } };
$('#getToday').onclick = async () => { const selectedDate = $('#planDate').value; const button = $('#getToday'); setEditingMode(); setRegisterStep(3, { allowBack: true }); setImportMessage(`${selectedDate} 일정을 확인하고 있습니다.`); button.disabled = true; try { const isToday = selectedDate === today; const result = isToday ? await bridge.epoly.todayHomework() : await bridge.epoly.dateHomework(selectedDate); source = isToday ? 'epoly-today' : 'epoly-date'; $('#sourceLabel').textContent = isToday ? 'e-POLY 오늘' : `e-POLY ${selectedDate}`; if (!result.tasks.length) { setCourses([]); setRegisterStep(3, { allowBack: true }); setMessage(''); return setImportMessage(`${selectedDate}에 등록된 숙제가 없습니다.`, 'empty'); } setCourses(result.tasks); setRegisterStep(4); setMessage(`${selectedDate} 숙제를 가져왔습니다.`); setImportMessage(`${result.tasks.length}개 과목을 가져왔습니다. 내용을 확인해 주세요.`, 'success'); } catch (error) { setCourses([]); setRegisterStep(3, { allowBack: true }); setMessage(error.message, true); setImportMessage(error.message, 'error'); } finally { button.disabled = false; } };
function updateHistoryControls() {
  if ($('#historyBack')) $('#historyBack').disabled = pageHistoryIndex <= 0;
  if ($('#historyForward')) $('#historyForward').disabled = pageHistoryIndex >= pageHistory.length - 1;
}
function scrollGanttToToday() {
  const host = $('#ganttChart');
  if (!host?.querySelector('.today-col')) return;
  const moveToEnd = () => { host.scrollLeft = Math.max(0, host.scrollWidth - host.clientWidth); };
  moveToEnd();
  requestAnimationFrame(() => {
    moveToEnd();
    requestAnimationFrame(moveToEnd);
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
  if (page === 'progress') renderChecklist();
  if (page === 'register') refreshStatus().catch(error => setMessage(error.message, true));
  if (page === 'notes') renderNotes();
  updateHistoryControls();
}
function goBack() { if (pageHistoryIndex <= 0) return; pageHistoryIndex -= 1; showPage(pageHistory[pageHistoryIndex], { record: false }); }
function goForward() { if (pageHistoryIndex >= pageHistory.length - 1) return; pageHistoryIndex += 1; showPage(pageHistory[pageHistoryIndex], { record: false }); }
$('#register').onclick = async () => { const value = draft(); if (!value.date || !value.items.length) return setMessage('날짜와 과목을 하나 이상 입력하세요.', true); try { if (editingTarget) await bridge.plan.updateItem(editingTarget, value.items[0]); else await bridge.plan.register(value); const wasEditing = Boolean(editingTarget); const plans = await bridge.plan.read(); setEditingMode(); source = 'manual'; $('#sourceLabel').textContent = '직접 입력'; setCourses([{ title: '', detail: '', dueDate: '', startDate: $('#planDate').value }]); setRegisterStep(1, { allowBack: true }); showRegistered(plans); showPage('progress'); setMessage(wasEditing ? '일정을 수정했습니다.' : '등록했습니다.'); } catch (error) { setMessage(error.message, true); } };
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
function renderNotes() { const host = $('#notesList'); if (!host) return; if (!notes.length) { host.innerHTML = '<div class="notes-empty"><span>📝</span><strong>아직 메모가 없습니다</strong><p>숙제와 관련된 준비물이나 잊지 말아야 할 내용을 기록해 보세요.</p><button type="button" data-create-note>첫 메모 만들기</button></div>'; return; } host.innerHTML = `<button class="note-add-tile" type="button" data-create-note aria-label="메모 추가"><b>＋</b><span>메모 추가</span></button>${notes.map(note => `<article class="note-card" data-note-id="${note.id}"><div class="note-card-head"><input data-note-title value="${escapeHtml(note.title)}" placeholder="메모 제목" aria-label="메모 제목"><button type="button" data-delete-note aria-label="메모 삭제">삭제</button></div><textarea data-note-body placeholder="메모 내용을 입력하세요" aria-label="메모 내용">${escapeHtml(note.body)}</textarea><footer>${noteDate(note.updatedAt)}</footer></article>`).join('')}`; }
function createNote() { const note = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: '', body: '', updatedAt: new Date().toISOString() }; notes.unshift(note); saveNotes(); renderNotes(); requestAnimationFrame(() => $('#notesList [data-note-title]')?.focus()); }
$('#notesList').onclick = event => { if (event.target.closest('[data-create-note]')) return createNote(); const card = event.target.closest('[data-note-id]'); if (!card || !event.target.closest('[data-delete-note]')) return; notes = notes.filter(note => note.id !== card.dataset.noteId); saveNotes(); renderNotes(); };
$('#notesList').oninput = event => { const card = event.target.closest('[data-note-id]'); if (!card) return; const note = notes.find(item => item.id === card.dataset.noteId); if (!note) return; if (event.target.matches('[data-note-title]')) note.title = event.target.value; if (event.target.matches('[data-note-body]')) note.body = event.target.value; note.updatedAt = new Date().toISOString(); saveNotes(); card.querySelector('footer').textContent = noteDate(note.updatedAt); };
renderNotes();
setInterval(() => {
  if (document.querySelector('.nav-item.active')?.dataset.page !== 'register') return;
  refreshStatus().catch(() => {});
}, 3000);
document.querySelector('#overviewPage .page-title').insertAdjacentElement('afterend', $('#scheduleFilterBar'));
$('#ganttMonth').value = today.slice(0, 7); $('#ganttMonth').onchange = () => { renderGantt(); renderChecklist(); };
let monthPickerYear = Number(today.slice(0, 4));
function updateMonthPicker() {
  const value = $('#ganttMonth').value || today.slice(0, 7);
  const [year, month] = value.split('-').map(Number);
  $('#monthPickerText').textContent = `${year}. ${String(month).padStart(2, '0')}`;
  const yearSelect = $('#monthPickerYearSelect');
  yearSelect.innerHTML = Array.from({ length: 11 }, (_, index) => monthPickerYear - 5 + index).map(optionYear => `<option value="${optionYear}">${optionYear}년</option>`).join('');
  yearSelect.value = String(monthPickerYear);
  $('#monthGrid').innerHTML = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const selected = year === monthPickerYear && month === number;
    return `<button type="button" data-month="${number}" class="${selected ? 'selected' : ''}">${number}월</button>`;
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
$('#monthPickerButton').onclick = event => {
  event.stopPropagation();
  const popover = $('#monthPopover');
  popover.hidden = !popover.hidden;
  $('#monthPickerButton').setAttribute('aria-expanded', String(!popover.hidden));
  monthPickerYear = Number(($('#ganttMonth').value || today).slice(0, 4));
  updateMonthPicker();
};
$('#monthPickerYearSelect').onchange = event => { event.stopPropagation(); monthPickerYear = Number(event.target.value); updateMonthPicker(); };
$('#monthPopover').onclick = event => event.stopPropagation();
document.addEventListener('click', () => { $('#monthPopover').hidden = true; $('#monthPickerButton').setAttribute('aria-expanded', 'false'); });
updateMonthPicker();
progressScope = overviewScope;
function isVisibleTask(item, done) { const monthValue = $('#ganttMonth').value || today.slice(0, 7); const [year, month] = monthValue.split('-').map(Number); const first = `${monthValue}-01`; const last = `${monthValue}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`; const start = item.startDate || item.date; const due = item.dueDate || start; if (start > last || due < first) return false; const diff = dayDiff(due); if (progressScope === 'all') return true; if (progressScope === 'urgent') return !done && diff !== '' && diff <= 3; if (progressScope === 'today') return !done && (due === today || item.startDate === today); const weekEnd = new Date(`${today}T00:00:00`); weekEnd.setDate(weekEnd.getDate() + 6); return !done && due <= weekEnd.toISOString().slice(0, 10); }
function renderSidebarSummary() { const host = $('#sidebarSummary'); if (!host) return; const monthValue = $('#ganttMonth').value || today.slice(0, 7); const items = allItems().filter(item => { const start = item.startDate || item.date; const due = item.dueDate || start; return start?.startsWith(monthValue) || due?.startsWith(monthValue); }); const tasks = items.flatMap(item => lines(item).map((_, index) => ({ done: Boolean(item.done?.[index]), dueDate: item.dueDate }))); const done = tasks.filter(task => task.done).length; const remaining = tasks.length - done; const urgent = tasks.filter(task => { const diff = dayDiff(task.dueDate); return !task.done && diff !== '' && diff >= 0 && diff <= 3; }).length; const rate = tasks.length ? Math.round(done / tasks.length * 100) : 0; host.innerHTML = `<div class="sidebar-summary-head"><span>이번 달 요약</span><b>${monthValue.replace('-', '. ')}</b></div><div class="sidebar-summary-stats"><div><span>남은 할 일</span><strong>${remaining}</strong></div><div><span>마감 임박</span><strong>${urgent}</strong></div></div><div class="sidebar-summary-progress"><span><b>완료율</b><em>${rate}%</em></span><i><b style="width:${rate}%"></b></i></div>`; }
function renderChecklist() { const host = $('#checklistList'); const tasks = allItems().flatMap(item => lines(item).map((text, lineIndex) => ({ item, text, lineIndex, done: Boolean(item.done?.[lineIndex]) }))).filter(task => isVisibleTask(task.item, task.done)); host.innerHTML = ''; $('#taskCount').textContent = progressScope === 'urgent' ? `3일 이내 · ${tasks.length}개` : `${tasks.filter(task => !task.done).length}개 남음`; if (!tasks.length) { host.innerHTML = progressScope === 'urgent' ? '<p class="muted">3일 이내 마감인 미완료 할 일이 없습니다.</p>' : '<p class="muted">이 범위에 표시할 할 일이 없습니다.</p>'; return; } tasks.sort((a, b) => (a.done - b.done) || (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999')).forEach(task => { const diff = dayDiff(task.item.dueDate); const dueLabel = diff === '' ? '마감일 없음' : diff < 0 ? '기한 지남' : diff === 0 ? 'D-day' : `D-${diff}`; const urgency = !task.done && diff !== '' && diff <= 1 ? 'critical' : !task.done && diff !== '' && diff <= 3 ? 'soon' : ''; const row = document.createElement('label'); row.className = `action-task ${task.done ? 'done' : ''} ${urgency}`; row.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}/><span class="task-box"></span><span class="task-body"><small>${escapeHtml(task.item.title)}</small><strong>${escapeHtml(task.text)}</strong></span><span class="task-deadline">${dueLabel}</span>`; host.append(row); row.querySelector('input').onchange = async event => { try { const result = await bridge.plan.toggleLine(task.item.date, task.item.itemIndex, task.lineIndex, event.target.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); event.target.checked = !event.target.checked; } }; }); }
function courseTargets(course) { return [...new Map(course.tasks.map(task => [`${task.item.date}:${task.item.itemIndex}`, { date: task.item.date, itemIndex: task.item.itemIndex }])).values()]; }
function editSchedule(course) {
  const item = course.tasks[0]?.item;
  if (!item) return;
  setEditingMode({ date: item.date, itemIndex: item.itemIndex });
  source = 'manual';
  $('#sourceLabel').textContent = '등록 일정 수정';
  $('#planDate').value = item.date;
  setCourses([{ title: item.title, detail: item.detail, dueDate: item.dueDate, startDate: item.startDate }]);
  setRegisterStep(4, { allowBack: true });
  setImportMessage('');
  setMessage('과목과 내용을 수정한 뒤 수정 저장을 눌러 주세요.');
  showPage('register');
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
document.addEventListener('click', closeScheduleMenus);
function renderChecklist() {
  renderSidebarSummary();
  const host = $('#checklistList');
  const groups = new Map();
  allItems().forEach(item => lines(item).forEach((text, lineIndex) => {
    const done = Boolean(item.done?.[lineIndex]);
    if (!isVisibleTask(item, done)) return;
    const key = courseKey(item.title, item.dueDate);
    if (!groups.has(key)) groups.set(key, { key, title: item.title, dueDate: item.dueDate, tasks: [] });
    groups.get(key).tasks.push({ item, text, lineIndex, done });
  }));
  const courses = [...groups.values()].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  host.innerHTML = '';
  $('#taskCount').textContent = progressScope === 'urgent' ? `3일 이내 · ${courses.reduce((count, course) => count + course.tasks.length, 0)}개` : `${courses.reduce((count, course) => count + course.tasks.filter(task => !task.done).length, 0)}개 남음`;
  if (!courses.length) { host.innerHTML = progressScope === 'urgent' ? '<p class="muted">3일 이내 마감인 미완료 할 일이 없습니다.</p>' : '<p class="muted">이 범위에 표시할 할 일이 없습니다.</p>'; return; }
  courses.forEach(course => {
    const diff = dayDiff(course.dueDate);
    const dueLabel = diff === '' ? '마감일 없음' : diff < 0 ? '기한 지남' : diff === 0 ? 'D-day' : `D-${diff}`;
    const urgency = diff !== '' && diff <= 1 ? 'critical' : diff !== '' && diff <= 3 ? 'soon' : '';
    const palette = coursePalette(course.title);
    const card = document.createElement('article');
    card.className = `action-course ${urgency} ${course.key === selectedCourseKey ? 'is-target' : ''}`;
    card.dataset.courseKey = course.key;
    card.style.setProperty('--course-bg', palette.bg); card.style.setProperty('--course-border', palette.border); card.style.setProperty('--course-soft', palette.soft); card.style.setProperty('--course-text', palette.text);
    card.innerHTML = `<header><div><span class="course-dot"></span><strong>${escapeHtml(course.title)}</strong><small>마감 ${formatDate(course.dueDate)}</small></div><div class="action-course-meta"><span class="task-deadline">${dueLabel}</span><div class="schedule-actions"><button type="button" class="schedule-more" aria-label="일정 메뉴" aria-expanded="false">•••</button><div class="schedule-menu"><button type="button" data-edit-schedule><span>✎</span>일정 수정</button><button type="button" data-delete-schedule><span>×</span>일정 삭제</button></div></div></div></header><div class="action-course-tasks">${course.tasks.map(task => `<label class="action-course-line ${task.done ? 'done' : ''}"><input type="checkbox" ${task.done ? 'checked' : ''}/><span class="task-box"></span><span>${escapeHtml(task.text)}</span></label>`).join('')}</div><footer>${course.tasks.filter(task => task.done).length}/${course.tasks.length} 완료</footer>`;
    host.append(card);
    card.querySelectorAll('input').forEach((input, index) => input.onchange = async event => { const task = course.tasks[index]; try { const result = await bridge.plan.toggleLine(task.item.date, task.item.itemIndex, task.lineIndex, event.target.checked); savedPlans = result.plans; renderChecklist(); renderGantt(); } catch (error) { setMessage(error.message, true); event.target.checked = !event.target.checked; } });
    const menu = card.querySelector('.schedule-menu');
    const more = card.querySelector('.schedule-more');
    more.onclick = event => { event.stopPropagation(); const opening = !menu.classList.contains('open'); closeScheduleMenus(); menu.classList.toggle('open', opening); more.setAttribute('aria-expanded', String(opening)); };
    card.querySelector('[data-edit-schedule]').onclick = event => { event.stopPropagation(); editSchedule(course); };
    card.querySelector('[data-delete-schedule]').onclick = event => { event.stopPropagation(); deleteSchedule(course); };
  });
}
(async () => { try { await refreshStatus(); showRegistered(await bridge.plan.read()); } catch (error) { setMessage(error.message, true); } })();
