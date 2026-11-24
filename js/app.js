import * as S from './store.js';
import * as ST from './stats.js';
import {
  esc, parseNum, fmtNum, fmtIn, fmtDuration, fmtPace, fmtMinutes, fmtMonth,
  fmtDate, fmtDateShort, fmtTime, toLocalInput, fromLocalInput, localDateKey, plural,
} from './util.js';

const $ = (s) => document.querySelector(s);
const main = $('#main'), titleEl = $('#title'), backBtn = $('#back');
const modal = $('#modal'), modalBody = $('#modal-body'), toastEl = $('#toast'), importInput = $('#import-file');

const TITLES = { workout: 'Тренування', history: 'Історія', stats: 'Статистика', exercises: 'Вправи', more: 'Ще' };
const state = {
  tab: 'workout', detailId: null, exFilter: 'all',
  // Статистика: місяць календаря (перше число), вибраний день, вправа, показник, період, таблиця
  stats: { month: null, day: null, exId: null, metric: null, period: '3m', table: false },
};

/** data-атрибути з об'єкта */
const da = (o) => Object.entries(o).map(([k, v]) => `data-${k}="${esc(v ?? '')}"`).join(' ');
const nowIso = () => new Date().toISOString();

// ====================================================================
// Рендер
// ====================================================================

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  let title = TITLES[state.tab], html;

  if (state.tab === 'history' && state.detailId) {
    const w = S.workoutById(state.detailId);
    if (!w) { state.detailId = null; return render(); }
    title = fmtDate(w.startedAt);
    html = workoutEditor(w, !w.finishedAt);
  } else {
    html = { workout: viewWorkoutTab, history: viewHistory, stats: viewStats, exercises: viewExercises, more: viewMore }[state.tab]();
  }
  backBtn.hidden = !(state.tab === 'history' && state.detailId);
  titleEl.textContent = title;
  main.innerHTML = html;
  if (state.tab === 'more') fillStorageStatus();
  if (state.tab === 'stats') drawChart();
}

// ---------- Форматування підходів ----------

const exType = (exerciseId) => S.exerciseById(exerciseId)?.type || 'strength';

function fmtSet(type, s) {
  switch (type) {
    case 'strength': return `${fmtNum(s.weight)} кг × ${s.reps}`;
    case 'bodyweight': return `${s.reps} повт.${s.weight ? ` <span class="muted">+${fmtNum(s.weight)} кг</span>` : ''}`;
    case 'cardio': {
      const parts = [];
      if (s.distance != null) parts.push(`${fmtNum(s.distance)} км`);
      if (s.duration) parts.push(fmtDuration(s.duration));
      let out = parts.join(' · ');
      if (s.distance && s.duration) out += ` <span class="muted">${fmtPace(s.duration / s.distance)} /км</span>`;
      return out;
    }
    case 'time': return fmtDuration(s.duration);
  }
  return '';
}

/** Короткий запис для рядка «Минулого разу»: 60×10, 62,5×8 */
function fmtSetShort(type, s) {
  switch (type) {
    case 'strength': return `${fmtIn(s.weight)}×${s.reps}`;
    case 'bodyweight': return s.weight ? `${s.reps} (+${fmtIn(s.weight)})` : `${s.reps}`;
    case 'cardio': return [s.distance ? `${fmtIn(s.distance)} км` : '', s.duration ? fmtDuration(s.duration) : ''].filter(Boolean).join(' ');
    case 'time': return fmtDuration(s.duration);
  }
  return '';
}

function entrySummary(type, sets) {
  if (!sets.length) return '';
  const sum = (f) => sets.reduce((a, s) => a + (f(s) || 0), 0);
  switch (type) {
    case 'strength':
      return `Тоннаж ${fmtNum(sum((s) => s.weight * s.reps))} кг · макс ${fmtNum(Math.max(...sets.map((s) => s.weight)))} кг`;
    case 'bodyweight': return `Всього ${sum((s) => s.reps)} повт.`;
    case 'cardio': {
      const d = sum((s) => s.distance), t = sum((s) => s.duration);
      return ['Всього', d ? `${fmtNum(d)} км` : '', t ? fmtDuration(t) : ''].filter(Boolean).join(' ');
    }
    case 'time': return `Всього ${fmtDuration(sum((s) => s.duration))}`;
  }
  return '';
}

// ---------- Поля вводу підходу ----------

function fld(name, label, value, mode = 'decimal') {
  const pattern = mode === 'numeric' ? ' pattern="[0-9]*"' : '';
  return `<label class="fld"><span>${label}</span><input name="${name}" inputmode="${mode}"${pattern} autocomplete="off" enterkeyhint="done" value="${esc(value ?? '')}"></label>`;
}

function durFields(sec, withHours) {
  let h = '', m = '', s = '';
  if (sec != null) {
    const t = Math.round(sec);
    if (withHours) { h = Math.floor(t / 3600) || ''; m = Math.floor((t % 3600) / 60); }
    else m = Math.floor(t / 60);
    s = t % 60;
  }
  return (withHours ? fld('h', 'Год', h, 'numeric') : '') + fld('m', 'Хв', m, 'numeric') + fld('s', 'Сек', s, 'numeric');
}

function setFields(type, s) {
  switch (type) {
    case 'strength': return fld('weight', 'Вага, кг', fmtIn(s?.weight)) + fld('reps', 'Повторення', s?.reps, 'numeric');
    case 'bodyweight': return fld('reps', 'Повторення', s?.reps, 'numeric') + fld('weight', '+ вага, кг', fmtIn(s?.weight));
    case 'cardio': return fld('distance', 'Км', fmtIn(s?.distance)) + durFields(s?.duration, true);
    case 'time': return durFields(s?.duration, false);
  }
  return '';
}

/** Зчитати й перевірити підхід з форми. Повертає {set} або {error}. */
function readSet(type, fd) {
  const g = (k) => parseNum(fd.get(k));
  const bad = (v) => Number.isNaN(v);
  const validReps = (r) => Number.isInteger(r) && r > 0 && r < 10000;
  const readDuration = () => {
    const h = g('h') ?? 0, m = g('m') ?? 0, s = g('s') ?? 0;
    if ([h, m, s].some((v) => bad(v) || v < 0)) return NaN;
    const t = Math.round(h * 3600 + m * 60 + s);
    return t > 0 ? t : null;
  };
  const set = { weight: null, reps: null, distance: null, duration: null };

  if (type === 'strength') {
    const w = g('weight'), r = g('reps');
    if (w == null || bad(w) || w < 0 || w > 2000) return { error: 'Вкажи вагу' };
    if (!validReps(r)) return { error: 'Вкажи кількість повторень (ціле число)' };
    set.weight = w; set.reps = r;
  } else if (type === 'bodyweight') {
    const w = g('weight'), r = g('reps');
    if (!validReps(r)) return { error: 'Вкажи кількість повторень (ціле число)' };
    if (bad(w) || (w != null && (w < 0 || w > 2000))) return { error: 'Додаткова вага вказана неправильно' };
    set.reps = r; set.weight = w || null;
  } else if (type === 'cardio') {
    const d = g('distance'), t = readDuration();
    if (bad(d) || (d != null && d < 0)) return { error: 'Дистанція вказана неправильно' };
    if (bad(t)) return { error: 'Час вказано неправильно' };
    if (!d && !t) return { error: 'Вкажи дистанцію або час' };
    set.distance = d || null; set.duration = t;
  } else {
    const t = readDuration();
    if (bad(t) || !t) return { error: 'Вкажи тривалість' };
    set.duration = t;
  }
  return { set };
}

// ---------- Вкладка «Тренування» ----------

function backupBanner() {
  const d = S.get();
  if (!d.workouts.some((w) => w.finishedAt)) return '';
  const last = d.settings.lastBackupAt;
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  if (days !== null && days < 7) return '';
  const text = days === null
    ? 'Резервної копії ще немає.'
    : `Остання резервна копія — ${days} ${plural(days, 'день', 'дні', 'днів')} тому.`;
  return `<div class="banner"><span>💾 ${text}</span><button class="btn small primary" data-action="export">Зробити</button></div>`;
}

function viewWorkoutTab() {
  const w = S.activeWorkout();
  if (w) return backupBanner() + workoutEditor(w, true);
  const last = S.finishedWorkouts()[0];
  return `${backupBanner()}
    <div class="hero">
      <button class="btn primary big" data-action="start-workout">Почати тренування</button>
      <p class="muted small">Дата і час запишуться автоматично</p>
    </div>
    ${!S.get().exercises.length ? `<div class="card tip"><b>Порада:</b> вправи можна створювати прямо під час тренування — натисни «Додати вправу» і впиши назву. Або заздалегідь у вкладці «Вправи».</div>` : ''}
    ${templatesSection()}
    ${last ? `<h2 class="section">Останнє тренування</h2>${workoutCard(last)}` : ''}`;
}

function templatesSection() {
  const tpls = S.get().templates.slice().sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const cards = tpls.map((t) => {
    const names = t.exerciseIds.map((id) => S.exerciseById(id)).filter((x) => x && !x.archived).map((x) => esc(x.name));
    return `<div class="card tcard">
        <button class="tcard-main" data-action="start-template" ${da({ id: t.id })}>
          <div class="strong">▶ ${esc(t.name)}</div>
          <div class="muted small">${names.join(' · ') || 'Немає вправ'}</div>
        </button>
        <button class="icon" data-action="edit-template" ${da({ id: t.id })} aria-label="Редагувати шаблон">✎</button>
      </div>`;
  }).join('');
  return `<h2 class="section">Шаблони</h2>
    ${cards || '<p class="muted small tpl-hint">Шаблон — це готовий набір вправ, напр. «День ніг». Почни тренування з нього одним натиском.</p>'}
    <button class="btn block" data-action="new-template">+ Новий шаблон</button>`;
}

function workoutEditor(w, isActive) {
  const entries = w.entries.map((e) => entryCard(w, e)).join('');
  return `
    <div class="card wk-meta" data-action="edit-workout-meta" ${da({ wid: w.id })}>
      <div>
        <div class="muted small">${isActive ? 'Розпочато' : 'Дата і час'}</div>
        <div class="strong">${fmtDate(w.startedAt)}, ${fmtTime(w.startedAt)}${w.finishedAt ? '–' + fmtTime(w.finishedAt) : ''}</div>
        ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
      </div>
      <span class="icon" aria-hidden="true">✎</span>
    </div>
    ${entries || '<p class="empty">Додай першу вправу 👇</p>'}
    <button class="btn block" data-action="add-exercise" ${da({ wid: w.id })}>+ Додати вправу</button>
    ${w.entries.length ? `<button class="btn ghost block" data-action="save-as-template" ${da({ wid: w.id })}>Зберегти як шаблон</button>` : ''}
    ${isActive
      ? `<button class="btn primary block" data-action="finish-workout" ${da({ wid: w.id })}>Завершити тренування</button>`
      : `<button class="btn danger-ghost block" data-action="delete-workout" ${da({ wid: w.id })}>Видалити тренування</button>`}`;
}

function entryCard(w, e) {
  const ex = S.exerciseById(e.exerciseId);
  const type = ex?.type || 'strength';
  const ids = { wid: w.id, eid: e.id };
  const prs = ST.prFlags(w, e, type);
  const sets = e.sets.map((s, j) => {
    const pr = prs.get(s.id);
    return `<li><button class="set" data-action="edit-set" ${da({ ...ids, sid: s.id })}><span class="n">${j + 1}</span><span>${fmtSet(type, s)}</span>${pr ? `<span class="pr" title="Рекорд: ${pr.join(', ')}">🏆 ${pr.join(', ')}</span>` : ''}</button></li>`;
  }).join('');
  const summary = entrySummary(type, e.sets);
  const prev = S.lastPerformance(e.exerciseId, w);
  // Підказка у полях: останній підхід цього тренування, а якщо ще немає — перший підхід минулого разу.
  const prefill = e.sets[e.sets.length - 1] || prev?.e.sets[0];
  return `
    <section class="card entry" ${da({ eid: e.id })}>
      <header class="entry-head">
        <div><h3>${esc(ex?.name || 'Видалена вправа')}</h3><span class="muted small">${S.TYPES[type].label}</span></div>
        <button class="icon" data-action="entry-menu" ${da(ids)} aria-label="Дії з вправою">⋯</button>
      </header>
      ${prev ? `<div class="last"><span class="muted">Минулого разу · ${fmtDateShort(prev.w.startedAt)}</span><br>${prev.e.sets.map((s) => fmtSetShort(type, s)).join(', ')}</div>` : ''}
      ${sets ? `<ol class="sets">${sets}</ol>` : ''}
      <form class="add-set" data-form="add-set" ${da(ids)}>
        ${setFields(type, prefill)}
        <button class="btn primary add" type="submit" aria-label="Додати підхід">+</button>
      </form>
      ${summary ? `<div class="summary">${summary}</div>` : ''}
    </section>`;
}

// ---------- Вкладка «Історія» ----------

function workoutCard(w) {
  const names = w.entries.map((e) => esc(S.exerciseById(e.exerciseId)?.name || '?'));
  const setsCount = S.countSets([w]);
  const dur = w.finishedAt ? Math.max(0, Math.round((Date.parse(w.finishedAt) - Date.parse(w.startedAt)) / 60000)) : null;
  return `
    <button class="card wcard" data-action="open-workout" ${da({ id: w.id })}>
      <div class="wcard-top"><span class="strong">${fmtDate(w.startedAt)}</span>${!w.finishedAt ? '<span class="badge">триває</span>' : ''}</div>
      <div class="muted small">${fmtTime(w.startedAt)}${w.finishedAt ? '–' + fmtTime(w.finishedAt) : ''}${dur != null ? ` · ${fmtMinutes(dur)}` : ''} · ${w.entries.length} ${plural(w.entries.length, 'вправа', 'вправи', 'вправ')}, ${setsCount} ${plural(setsCount, 'підхід', 'підходи', 'підходів')}</div>
      ${names.length ? `<div class="wcard-ex">${names.join(' · ')}</div>` : ''}
      ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
    </button>`;
}

function viewHistory() {
  const list = S.sortedWorkouts();
  let html = `<div class="toolbar"><button class="btn" data-action="add-past-workout">+ Додати минуле тренування</button></div>`;
  if (!list.length) return html + `<p class="empty">Тут з'являться твої тренування.</p>`;
  let month = '';
  for (const w of list) {
    const m = fmtMonth(w.startedAt);
    if (m !== month) { month = m; html += `<h2 class="section">${m}</h2>`; }
    html += workoutCard(w);
  }
  return html;
}

// ---------- Вкладка «Статистика» ----------

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const PERIODS = [['1m', '1 міс'], ['3m', '3 міс'], ['1y', 'Рік'], ['all', 'Все']];

function periodStart(p) {
  const d = new Date();
  if (p === '1m') d.setMonth(d.getMonth() - 1);
  else if (p === '3m') d.setMonth(d.getMonth() - 3);
  else if (p === '1y') d.setFullYear(d.getFullYear() - 1);
  else return 0;
  return d.getTime();
}

function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function viewStats() {
  const all = S.get().workouts;
  if (!all.length) return '<p class="empty">Статистика з\'явиться після першого тренування.</p>';
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const wk = weekStart(now).getTime();
  const count = (from) => all.filter((w) => Date.parse(w.startedAt) >= from).length;
  return `
    <div class="tiles">
      <div class="tile"><div class="tile-v">${count(wk)}</div><div class="tile-l">цього тижня</div></div>
      <div class="tile"><div class="tile-v">${count(monthStart)}</div><div class="tile-l">цього місяця</div></div>
      <div class="tile"><div class="tile-v">${all.length}</div><div class="tile-l">всього</div></div>
    </div>
    ${calendarSection()}
    ${progressSection()}`;
}

function calendarSection() {
  const st = state.stats, now = new Date();
  if (!st.month) st.month = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = st.month.getFullYear(), m = st.month.getMonth();
  const byDay = new Map();
  for (const w of S.get().workouts) {
    const k = localDateKey(new Date(w.startedAt));
    byDay.set(k, [...(byDay.get(k) || []), w]);
  }
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const todayKey = localDateKey(now);
  let cells = WEEKDAYS.map((d) => `<div class="wd">${d}</div>`).join('') + '<div></div>'.repeat(offset);
  let inMonth = 0;
  for (let day = 1; day <= days; day++) {
    const key = localDateKey(new Date(y, m, day));
    const ws = byDay.get(key);
    const cls = ['cal-day', ws ? 'on' : '', key === todayKey ? 'today' : '', key === st.day ? 'sel' : ''].join(' ');
    if (ws) {
      inMonth += ws.length;
      cells += `<button class="${cls}" data-action="cal-day" ${da({ key })} aria-label="${day}: ${ws.length} ${plural(ws.length, 'тренування', 'тренування', 'тренувань')}">${day}</button>`;
    } else cells += `<span class="${cls}">${day}</span>`;
  }
  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  const dayList = st.day && byDay.get(st.day);
  return `
    <section class="card">
      <div class="cal-head">
        <button class="icon" data-action="cal-month" data-dir="-1" aria-label="Попередній місяць">‹</button>
        <div class="strong">${fmtMonth(st.month.toISOString())}</div>
        <button class="icon" data-action="cal-month" data-dir="1" ${isCurrent ? 'disabled' : ''} aria-label="Наступний місяць">›</button>
      </div>
      <div class="cal">${cells}</div>
      <p class="muted small cal-foot">${inMonth} ${plural(inMonth, 'тренування', 'тренування', 'тренувань')} за місяць${inMonth ? ' · натисни на день, щоб побачити деталі' : ''}</p>
    </section>
    ${dayList ? dayList.map(workoutCard).join('') : ''}`;
}

/** Вправи, які хоч раз виконувались, — від нещодавніх */
function statExercises() {
  const usage = S.exerciseUsage();
  return S.get().exercises
    .filter((x) => usage.has(x.id))
    .sort((a, b) => Date.parse(usage.get(b.id).last) - Date.parse(usage.get(a.id).last));
}

function currentChart() {
  const st = state.stats;
  const list = statExercises();
  if (!list.length) return null;
  if (!list.some((x) => x.id === st.exId)) st.exId = list[0].id;
  const ex = S.exerciseById(st.exId);
  const metrics = ST.METRICS[ex.type];
  const metric = metrics.find((m) => m.id === st.metric) || metrics[0];
  st.metric = metric.id;
  return { list, ex, metrics, metric, pts: ST.series(ex.id, metric, periodStart(st.period)) };
}

function progressSection() {
  const c = currentChart();
  if (!c) return '';
  const st = state.stats;
  const { list, ex, metrics, metric, pts } = c;
  const options = list.map((x) => `<option value="${esc(x.id)}" ${x.id === ex.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const chips = (items, cur, action) => `<div class="chips scroll">${items.map(([id, label]) =>
    `<button class="chip-btn ${id === cur ? 'on' : ''}" data-action="${action}" ${da({ v: id })}>${label}</button>`).join('')}</div>`;
  const table = st.table
    ? `<div class="ttable">${pts.slice().reverse().map((p) => `
        <button class="trow" data-action="open-workout" ${da({ id: p.wid })}>
          <span>${fmtDate(new Date(p.t).toISOString())}</span><span class="strong">${ST.fmtMetric(metric, p.v)}</span></button>`).join('') || '<p class="muted small">Немає даних за цей період.</p>'}</div>`
    : '';
  const recs = ST.records(ex.id, ex.type).map((r) => `
      <button class="tile rec" data-action="open-workout" ${da({ id: r.wid })}>
        <div class="tile-l">${r.label}</div>
        <div class="tile-v">${esc(r.value)}</div>
        <div class="tile-l">${r.sub ? esc(r.sub) + ' · ' : ''}${fmtDateShort(r.at)}</div>
      </button>`).join('');
  return `
    <h2 class="section">Прогрес по вправі</h2>
    <select class="ex-select" data-change="stats-ex" aria-label="Вправа">${options}</select>
    ${chips(metrics.map((m) => [m.id, m.label]), metric.id, 'stats-metric')}
    ${chips(PERIODS, st.period, 'stats-period')}
    <section class="card chart-card">
      <div class="chart-title"><span class="strong">${metric.label}${metric.unit ? `, ${metric.unit}` : ''}</span>
        ${metric.id === 'e1rm' ? '<span class="muted small">розрахунок з найкращого підходу</span>' : ''}
        ${metric.lowerBetter ? '<span class="muted small">менше — краще</span>' : ''}</div>
      <div class="chart-wrap"><div id="chart" class="chart"></div><div id="chart-tip" class="chart-tip" hidden></div></div>
      <button class="btn ghost block small-btn" data-action="stats-table">${st.table ? 'Сховати таблицю' : 'Показати таблицею'}</button>
      ${table}
    </section>
    <h2 class="section">Рекорди 🏆</h2>
    <div class="tiles two">${recs}</div>`;
}

function niceTicks(lo, hi, n, int) {
  let step = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step));
  const err = step / mag;
  step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  if (int) step = Math.max(1, Math.round(step));
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const CHART_COLOR = '#e8662f';

function drawChart() {
  const el = $('#chart');
  const c = el && currentChart();
  if (!c) return;
  const { pts, metric } = c;
  if (pts.length < 2) {
    el.innerHTML = `<p class="muted small chart-empty">${pts.length
      ? `Лише одне тренування за цей період: ${ST.fmtMetric(metric, pts[0].v)}. Для графіка потрібно щонайменше два — або обери довший період.`
      : 'Немає даних за цей період. Обери довший період.'}</p>`;
    return;
  }
  const W = Math.max(260, el.clientWidth), H = 220, L = 46, R = 16, T = 22, B = 26;
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo === hi) { lo -= metric.int ? 1 : Math.max(1, Math.abs(lo) * 0.1); hi += metric.int ? 1 : Math.max(1, Math.abs(hi) * 0.1); }
  if (lo < 0) lo = 0;
  const ticks = niceTicks(lo, hi, 4, metric.int);
  lo = ticks[0]; hi = ticks[ticks.length - 1];
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const tickLabel = (v) => (metric.dur ? fmtDuration(v) : fmtNum(v));
  const dateLabel = (t) => fmtDateShort(new Date(t).toISOString());

  const grid = ticks.map((v) => `
      <line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${tickLabel(v)}</text>`).join('');
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const dots = pts.length <= 60 ? pts.map((p) => `<circle class="dot" cx="${x(p.t)}" cy="${y(p.v)}" r="4"/>`).join('') : '';
  const lastP = pts[pts.length - 1];
  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric.label)}: графік">
      ${grid}
      <text class="axis" x="${L}" y="${H - 6}" text-anchor="start">${dateLabel(t0)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${dateLabel(t1)}</text>
      <path d="${path}" fill="none" stroke="${CHART_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots.replaceAll('class="dot"', `class="dot" fill="${CHART_COLOR}"`)}
      <text class="vlabel" x="${Math.min(x(lastP.t), W - R)}" y="${y(lastP.v) - 10}" text-anchor="end">${ST.fmtMetric(metric, lastP.v)}</text>
      <line id="xhair" class="xhair" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <circle id="xdot" r="6" fill="${CHART_COLOR}" class="dot" visibility="hidden"/>
      <rect id="hit" x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}" fill="transparent"/>
    </svg>`;

  // Підказка: палець або миша знаходить найближче тренування по горизонталі.
  const svg = el.querySelector('svg'), tip = $('#chart-tip'), xh = $('#xhair'), xd = $('#xdot');
  const show = (ev) => {
    const px = ev.clientX - svg.getBoundingClientRect().left;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    const bx = x(best.t), by = y(best.v);
    xh.setAttribute('x1', bx); xh.setAttribute('x2', bx); xh.setAttribute('visibility', 'visible');
    xd.setAttribute('cx', bx); xd.setAttribute('cy', by); xd.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const v = document.createElement('div'); v.className = 'strong'; v.textContent = ST.fmtMetric(metric, best.v);
    const d = document.createElement('div'); d.className = 'muted small'; d.textContent = fmtDate(new Date(best.t).toISOString());
    tip.append(v, d);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(bx - tw / 2, 0), W - tw)}px`;
    tip.style.top = `${Math.max(by - 64, 0)}px`;
  };
  const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); xd.setAttribute('visibility', 'hidden'); };
  const hit = $('#hit');
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.tab === 'stats') drawChart(); }, 150);
});

// ---------- Вкладка «Вправи» ----------

function viewExercises() {
  const d = S.get(), usage = S.exerciseUsage(), f = state.exFilter;
  if (f !== 'all' && !S.groupById(f)) state.exFilter = 'all';
  const chips = `<div class="chips scroll">
      <button class="chip-btn ${state.exFilter === 'all' ? 'on' : ''}" data-action="ex-filter" data-g="all">Всі</button>
      ${d.muscleGroups.map((g) => `<button class="chip-btn ${state.exFilter === g.id ? 'on' : ''}" data-action="ex-filter" ${da({ g: g.id })}>${esc(g.name)}</button>`).join('')}
    </div>`;
  const match = (x) => state.exFilter === 'all' || x.muscleGroupIds.includes(state.exFilter);
  const sorted = d.exercises.slice().sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const visible = sorted.filter((x) => !x.archived && match(x));
  const hidden = sorted.filter((x) => x.archived && match(x));

  const card = (x) => {
    const u = usage.get(x.id);
    const gs = x.muscleGroupIds.map((id) => S.groupById(id)?.name).filter(Boolean);
    return `<button class="card" data-action="edit-exercise" ${da({ id: x.id })}>
        <div class="strong">${esc(x.name)}</div>
        <div class="muted small">${S.TYPES[x.type].label}${gs.length ? ' · ' + esc(gs.join(', ')) : ''}</div>
        <div class="muted small">${u ? `${u.count} ${plural(u.count, 'тренування', 'тренування', 'тренувань')} · останнє ${fmtDateShort(u.last)}` : 'Ще не виконувалась'}</div>
      </button>`;
  };

  let html = `<div class="toolbar"><button class="btn primary" data-action="new-exercise">+ Нова вправа</button></div>`;
  if (!d.exercises.length) return html + `<p class="empty">Ще немає вправ. Створи першу — наприклад «Жим штанги лежачи» або «Біг».</p>`;
  html += chips;
  html += visible.length ? visible.map(card).join('') : '<p class="empty">У цій групі немає вправ.</p>';
  if (hidden.length) html += `<h2 class="section">Сховані</h2>` + hidden.map(card).join('');
  return html;
}

// ---------- Вкладка «Ще» ----------

function viewMore() {
  const d = S.get();
  const last = d.settings.lastBackupAt;
  const groups = d.muscleGroups.map((g) => `
      <li><span>${esc(g.name)}</span>
        <button class="icon" data-action="edit-group" ${da({ id: g.id })} aria-label="Перейменувати">✎</button>
        <button class="icon" data-action="delete-group" ${da({ id: g.id })} aria-label="Видалити">✕</button></li>`).join('');
  return `
    <section class="card">
      <h3>Резервна копія</h3>
      <p class="muted small">${last ? `Остання: ${fmtDate(last)}, ${fmtTime(last)}` : 'Ще не робилася.'}</p>
      <button class="btn primary block" data-action="export">Експортувати у файл (JSON)</button>
      <button class="btn block" data-action="import">Імпортувати з файлу</button>
      <p class="muted small">Експорт відкриває меню «Поділитися» — надішли файл собі в Telegram, на пошту чи в iCloud Drive. Імпорт <b>замінює</b> всі поточні дані даними з файлу.</p>
    </section>

    <section class="card">
      <h3>Групи м'язів</h3>
      <ul class="glist">${groups || '<li><span class="muted">Немає груп</span></li>'}</ul>
      <button class="btn block" data-action="new-group">+ Додати групу</button>
    </section>

    <section class="card">
      <h3>Сховище</h3>
      <p class="small" id="install-status"></p>
      <p class="small muted" id="persist-status">Перевіряю…</p>
    </section>

    <section class="card">
      <h3>Дані</h3>
      <p class="small muted">${d.exercises.length} ${plural(d.exercises.length, 'вправа', 'вправи', 'вправ')} · ${d.workouts.length} ${plural(d.workouts.length, 'тренування', 'тренування', 'тренувань')} · ${S.countSets()} ${plural(S.countSets(), 'підхід', 'підходи', 'підходів')}</p>
    </section>`;
}

function fillStorageStatus() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const inst = $('#install-status');
  if (inst) inst.textContent = standalone
    ? '✓ Програма встановлена на головний екран.'
    : 'Програма відкрита в браузері. Після встановлення на головний екран дані зберігаються надійніше.';
  const el = $('#persist-status');
  if (!el) return;
  if (!navigator.storage?.persisted) { el.textContent = 'Роби резервні копії регулярно.'; return; }
  navigator.storage.persisted().then((p) => {
    el.textContent = p
      ? '✓ Браузер позначив дані як постійні. Резервні копії все одно потрібні.'
      : 'Браузер може очистити дані, якщо мало місця або програмою довго не користуватися. Роби резервні копії.';
  }).catch(() => { el.textContent = 'Роби резервні копії регулярно.'; });
}

// ====================================================================
// Модалки й сповіщення
// ====================================================================

function openModal(html, keepScroll = false) {
  const top = modal.scrollTop;
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
  modal.scrollTop = keepScroll ? top : 0;
}
function closeModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
modal.addEventListener('close', () => { document.body.appendChild(toastEl); });

let toastTimer;
function toast(msg, ms = 2200) {
  // Поверх модалки (top layer) звичайний елемент не видно — переносимо всередину.
  (modal.open ? modal : document.body).appendChild(toastEl);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

const cancelBtn = (label = 'Скасувати') => `<button type="button" class="btn" data-action="close-modal">${label}</button>`;

function openWorkoutMeta(w) {
  openModal(`<form data-form="workout-meta" ${da({ wid: w.id })}>
      <h2>Дата і нотатка</h2>
      <label class="fld"><span>Початок</span><input type="datetime-local" name="start" value="${toLocalInput(w.startedAt)}" required></label>
      ${w.finishedAt ? `<label class="fld"><span>Кінець</span><input type="datetime-local" name="end" value="${toLocalInput(w.finishedAt)}" required></label>` : ''}
      <label class="fld"><span>Нотатка</span><textarea name="note" rows="3" maxlength="500" placeholder="Самопочуття, сон, що вдалося…">${esc(w.note)}</textarea></label>
      <div class="row">${cancelBtn()}<button class="btn primary">Зберегти</button></div>
    </form>`);
}

function openPastWorkoutForm() {
  const end = new Date(), start = new Date(end.getTime() - 3600e3);
  openModal(`<form data-form="past-workout">
      <h2>Минуле тренування</h2>
      <label class="fld"><span>Початок</span><input type="datetime-local" name="start" value="${toLocalInput(start.toISOString())}" required></label>
      <label class="fld"><span>Кінець</span><input type="datetime-local" name="end" value="${toLocalInput(end.toISOString())}" required></label>
      <div class="row">${cancelBtn()}<button class="btn primary">Створити</button></div>
    </form>`);
}

function openPicker(wid) {
  openModal(`<h2>Додати вправу</h2>
      <input id="pick-search" class="search" type="search" placeholder="Пошук або назва нової вправи" autocomplete="off" enterkeyhint="search" ${da({ wid })}>
      <div id="pick-list">${pickList('', wid)}</div>
      <div class="row">${cancelBtn()}</div>`);
}

function pickList(q, wid) {
  const w = S.workoutById(wid);
  const inWorkout = new Set(w?.entries.map((e) => e.exerciseId));
  const usage = S.exerciseUsage();
  const name = q.trim().replace(/\s+/g, ' '), qq = name.toLowerCase();
  const last = (x) => usage.get(x.id)?.last ? Date.parse(usage.get(x.id).last) : 0;
  const list = S.get().exercises
    .filter((x) => !x.archived && (!qq || x.name.toLowerCase().includes(qq)))
    .sort((a, b) => last(b) - last(a) || a.name.localeCompare(b.name, 'uk'));
  const exact = S.get().exercises.some((x) => x.name.toLowerCase() === qq);

  let html = list.map((x) => `
      <button class="pick" data-action="pick-exercise" ${da({ wid, xid: x.id })}>
        <span>${esc(x.name)}</span>
        <span class="muted small">${S.TYPES[x.type].label}${inWorkout.has(x.id) ? ' · вже є' : ''}</span>
      </button>`).join('');
  if (!list.length) html = `<p class="muted">${qq ? 'Нічого не знайдено.' : 'Ще немає жодної вправи. Впиши назву вище, щоб створити.'}</p>`;
  html += `<button class="btn primary block" data-action="new-exercise" ${da({ wid, name })}>+ ${qq && !exact ? `Створити «${esc(name)}»` : 'Нова вправа'}</button>`;
  return html;
}

function openExerciseForm({ id = '', wid = '', name = '' } = {}) {
  const x = id ? S.exerciseById(id) : null;
  const used = x ? S.exerciseUsage().get(x.id)?.count || 0 : 0;
  const type = x?.type || 'strength';
  const groups = new Set(x?.muscleGroupIds || []);
  const types = Object.entries(S.TYPES).map(([k, t]) => `
      <label class="type-opt"><input type="radio" name="type" value="${k}" ${k === type ? 'checked' : ''} ${used && k !== type ? 'disabled' : ''}>
        <span><b>${t.label}</b><small>${t.hint}</small></span></label>`).join('');
  const chips = S.get().muscleGroups.map((g) => `
      <label class="chip"><input type="checkbox" name="g" value="${esc(g.id)}" ${groups.has(g.id) ? 'checked' : ''}><span>${esc(g.name)}</span></label>`).join('');

  openModal(`<form data-form="exercise" ${da({ id, wid })}>
      <h2>${x ? 'Редагувати вправу' : 'Нова вправа'}</h2>
      <label class="fld"><span>Назва</span><input name="name" value="${esc(x?.name ?? name)}" maxlength="60" required autocomplete="off" placeholder="Напр. Жим штанги лежачи"></label>
      <div class="fld"><span>Тип${used ? ' — не можна змінити, бо вже є записи' : ''}</span><div class="types">${types}</div></div>
      <div class="fld"><span>Групи м'язів (необов'язково)</span><div class="chips">${chips || '<span class="muted small">Груп немає — додай їх у вкладці «Ще».</span>'}</div></div>
      <button class="btn primary block">${wid && !x ? 'Створити і додати' : 'Зберегти'}</button>
      ${x ? `<div class="row">
          ${x.archived
            ? `<button type="button" class="btn" data-action="restore-exercise" ${da({ id })}>Повернути</button>`
            : `<button type="button" class="btn" data-action="hide-exercise" ${da({ id })}>Сховати</button>`}
          <button type="button" class="btn danger-ghost" data-action="delete-exercise" ${da({ id })}>Видалити</button>
        </div>
        <p class="muted small">«Сховати» прибирає вправу зі списків, але зберігає всю її історію.</p>` : ''}
      <div class="row">${cancelBtn()}</div>
    </form>`);
}

function openSetForm(wid, eid, sid) {
  const w = S.workoutById(wid), e = w?.entries.find((e) => e.id === eid);
  const idx = e?.sets.findIndex((s) => s.id === sid) ?? -1;
  if (idx < 0) return;
  const type = exType(e.exerciseId);
  openModal(`<form data-form="edit-set" ${da({ wid, eid, sid })}>
      <h2>Підхід ${idx + 1} · ${esc(S.exerciseById(e.exerciseId)?.name || '')}</h2>
      <div class="set-fields">${setFields(type, e.sets[idx])}</div>
      <button class="btn primary block">Зберегти</button>
      <div class="row">
        <button type="button" class="btn danger-ghost" data-action="delete-set" ${da({ wid, eid, sid })}>Видалити підхід</button>
        ${cancelBtn()}
      </div>
    </form>`);
}

function openEntryMenu(wid, eid) {
  const w = S.workoutById(wid), i = w?.entries.findIndex((e) => e.id === eid) ?? -1;
  if (i < 0) return;
  const e = w.entries[i], ids = { wid, eid };
  openModal(`<h2>${esc(S.exerciseById(e.exerciseId)?.name || 'Вправа')}</h2>
      <div class="menu">
        ${i > 0 ? `<button class="btn" data-action="entry-move" ${da({ ...ids, dir: -1 })}>↑ Перемістити вище</button>` : ''}
        ${i < w.entries.length - 1 ? `<button class="btn" data-action="entry-move" ${da({ ...ids, dir: 1 })}>↓ Перемістити нижче</button>` : ''}
        ${S.exerciseById(e.exerciseId) ? `<button class="btn" data-action="edit-exercise" ${da({ id: e.exerciseId })}>✎ Редагувати вправу</button>` : ''}
        <button class="btn danger-ghost" data-action="entry-delete" ${da(ids)}>Прибрати з тренування${e.sets.length ? ` (${e.sets.length} ${plural(e.sets.length, 'підхід', 'підходи', 'підходів')})` : ''}</button>
      </div>
      <div class="row">${cancelBtn()}</div>`);
}

function openGroupForm(id = '') {
  const g = id ? S.groupById(id) : null;
  openModal(`<form data-form="group" ${da({ id })}>
      <h2>${g ? 'Перейменувати групу' : 'Нова група м\'язів'}</h2>
      <label class="fld"><span>Назва</span><input name="name" value="${esc(g?.name || '')}" maxlength="40" required autocomplete="off"></label>
      <div class="row">${cancelBtn()}<button class="btn primary">Зберегти</button></div>
    </form>`);
}

// ---------- Редактор шаблону ----------
// Чернетка живе тут, поки вікно відкрите; у дані потрапляє лише після «Зберегти».

let tplDraft = null, tplQuery = '';

function openTemplateEditor(tpl, exerciseIds = []) {
  tplDraft = tpl
    ? { id: tpl.id, name: tpl.name, exerciseIds: [...tpl.exerciseIds] }
    : { id: '', name: '', exerciseIds: [...new Set(exerciseIds)] };
  tplQuery = '';
  renderTemplateEditor(false);
}

function tplAvailable() {
  const q = tplQuery.trim().toLowerCase();
  const chosen = new Set(tplDraft.exerciseIds);
  const list = S.get().exercises
    .filter((x) => !x.archived && !chosen.has(x.id) && (!q || x.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  if (!S.get().exercises.length) return '<p class="muted small">Спершу створи вправи у вкладці «Вправи».</p>';
  if (!list.length) return `<p class="muted small">${q ? 'Нічого не знайдено.' : 'Усі вправи вже додано.'}</p>`;
  return list.map((x) => `<button type="button" class="pick" data-action="tpl-add" ${da({ xid: x.id })}>
      <span>${esc(x.name)}</span><span class="muted small">+ додати</span></button>`).join('');
}

function renderTemplateEditor(keepScroll = true) {
  const ids = tplDraft.exerciseIds;
  const chosen = ids.map((xid, i) => `
      <li><span class="n">${i + 1}</span><span class="grow">${esc(S.exerciseById(xid)?.name || 'Видалена вправа')}</span>
        <button type="button" class="icon" data-action="tpl-move" ${da({ i, dir: -1 })} ${i === 0 ? 'disabled' : ''} aria-label="Вище">↑</button>
        <button type="button" class="icon" data-action="tpl-move" ${da({ i, dir: 1 })} ${i === ids.length - 1 ? 'disabled' : ''} aria-label="Нижче">↓</button>
        <button type="button" class="icon" data-action="tpl-remove" ${da({ i })} aria-label="Прибрати">✕</button></li>`).join('');
  openModal(`<form data-form="template">
      <h2>${tplDraft.id ? 'Редагувати шаблон' : 'Новий шаблон'}</h2>
      <label class="fld"><span>Назва</span><input id="tpl-name" name="name" value="${esc(tplDraft.name)}" maxlength="40" placeholder="Напр. День ніг" autocomplete="off"></label>
      <div class="fld"><span>Вправи в шаблоні (у порядку виконання)</span>
        ${chosen ? `<ol class="tlist">${chosen}</ol>` : '<p class="muted small">Ще немає — обери нижче.</p>'}</div>
      <div class="fld"><span>Додати вправу</span>
        <input id="tpl-search" type="search" placeholder="Пошук" autocomplete="off" value="${esc(tplQuery)}">
        <div id="tpl-avail">${tplAvailable()}</div></div>
      <button class="btn primary block">Зберегти шаблон</button>
      ${tplDraft.id ? '<button type="button" class="btn danger-ghost block" data-action="tpl-delete">Видалити шаблон</button>' : ''}
      <div class="row">${cancelBtn()}</div>
    </form>`, keepScroll);
}

function focusEntry(eid) {
  const card = document.querySelector(`.entry[data-eid="${CSS.escape(eid)}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'center' });
  card.querySelector('.add-set input')?.focus({ preventScroll: true });
}

// ====================================================================
// Дії
// ====================================================================

const findEntry = (wid, eid) => S.workoutById(wid)?.entries.find((e) => e.id === eid);

const actions = {
  tab({ tab }) { state.tab = tab; state.detailId = null; render(); window.scrollTo(0, 0); },
  back() { state.detailId = null; render(); },
  'close-modal': closeModal,

  'start-workout'() {
    S.mutate((d) => d.workouts.push({ id: S.uid(), startedAt: nowIso(), finishedAt: null, note: '', entries: [] }));
    render();
  },
  'finish-workout'({ wid }) {
    const w = S.workoutById(wid);
    if (!w) return;
    if (!w.entries.some((e) => e.sets.length)) {
      if (!confirm('У тренуванні немає жодного підходу. Видалити його?')) return;
      S.mutate((d) => { d.workouts = d.workouts.filter((x) => x.id !== wid); });
      return render();
    }
    if (!confirm('Завершити тренування?')) return;
    S.mutate(() => {
      w.finishedAt = nowIso();
      w.entries = w.entries.filter((e) => e.sets.length); // вправи без підходів не зберігаємо
    });
    render();
    window.scrollTo(0, 0);
    toast('Тренування збережено 💪');
  },
  'delete-workout'({ wid }) {
    if (!confirm('Видалити це тренування з усіма підходами? Скасувати буде неможливо.')) return;
    S.mutate((d) => { d.workouts = d.workouts.filter((x) => x.id !== wid); });
    state.detailId = null;
    render();
    toast('Тренування видалено');
  },
  'open-workout'({ id }) {
    const w = S.workoutById(id);
    if (!w) return;
    if (!w.finishedAt) { state.tab = 'workout'; state.detailId = null; }
    else { state.tab = 'history'; state.detailId = id; }
    render();
    window.scrollTo(0, 0);
  },
  'edit-workout-meta'({ wid }) { const w = S.workoutById(wid); if (w) openWorkoutMeta(w); },
  'add-past-workout': openPastWorkoutForm,

  'add-exercise'({ wid }) { openPicker(wid); },
  'pick-exercise'({ wid, xid }) {
    const w = S.workoutById(wid);
    if (!w) return;
    const eid = S.uid();
    S.mutate(() => w.entries.push({ id: eid, exerciseId: xid, sets: [] }));
    closeModal();
    render();
    focusEntry(eid);
  },
  'entry-menu'({ wid, eid }) { openEntryMenu(wid, eid); },
  'entry-move'({ wid, eid, dir }) {
    const w = S.workoutById(wid), i = w?.entries.findIndex((e) => e.id === eid) ?? -1, j = i + Number(dir);
    if (i < 0 || j < 0 || j >= w.entries.length) return;
    S.mutate(() => { [w.entries[i], w.entries[j]] = [w.entries[j], w.entries[i]]; });
    closeModal();
    render();
  },
  'entry-delete'({ wid, eid }) {
    const w = S.workoutById(wid), e = findEntry(wid, eid);
    if (!e) return;
    if (e.sets.length && !confirm('Прибрати вправу з тренування разом з її підходами?')) return;
    S.mutate(() => { w.entries = w.entries.filter((x) => x.id !== eid); });
    closeModal();
    render();
  },

  'edit-set'({ wid, eid, sid }) { openSetForm(wid, eid, sid); },
  'delete-set'({ wid, eid, sid }) {
    const e = findEntry(wid, eid);
    if (!e || !confirm('Видалити цей підхід?')) return;
    S.mutate(() => { e.sets = e.sets.filter((s) => s.id !== sid); });
    closeModal();
    render();
  },

  'new-exercise'({ wid = '', name = '' }) { openExerciseForm({ wid, name }); },
  'edit-exercise'({ id }) { openExerciseForm({ id }); },
  'hide-exercise'({ id }) {
    S.mutate(() => { S.exerciseById(id).archived = true; });
    closeModal(); render(); toast('Вправу сховано');
  },
  'restore-exercise'({ id }) {
    S.mutate(() => { S.exerciseById(id).archived = false; });
    closeModal(); render(); toast('Вправу повернуто');
  },
  'delete-exercise'({ id }) {
    const x = S.exerciseById(id);
    if (!x) return;
    const used = S.exerciseUsage().get(id)?.count || 0;
    const msg = used
      ? `«${x.name}» є в ${used} ${plural(used, 'тренуванні', 'тренуваннях', 'тренуваннях')}. Видалити вправу разом з усіма її підходами? Скасувати буде неможливо.\n\nЯкщо хочеш лише прибрати її зі списку — натисни «Скасувати» і обери «Сховати».`
      : `Видалити вправу «${x.name}»?`;
    if (!confirm(msg)) return;
    S.mutate((d) => {
      d.exercises = d.exercises.filter((e) => e.id !== id);
      for (const w of d.workouts) w.entries = w.entries.filter((e) => e.exerciseId !== id);
      for (const t of d.templates) t.exerciseIds = t.exerciseIds.filter((xid) => xid !== id);
    });
    closeModal(); render(); toast('Вправу видалено');
  },
  'ex-filter'({ g }) { state.exFilter = g; render(); },

  'new-group'() { openGroupForm(); },
  'edit-group'({ id }) { openGroupForm(id); },
  'delete-group'({ id }) {
    const g = S.groupById(id);
    if (!g || !confirm(`Видалити групу «${g.name}»? Вправи залишаться, просто без цієї групи.`)) return;
    S.mutate((d) => {
      d.muscleGroups = d.muscleGroups.filter((x) => x.id !== id);
      for (const x of d.exercises) x.muscleGroupIds = x.muscleGroupIds.filter((gid) => gid !== id);
    });
    render();
  },

  'new-template'() { openTemplateEditor(null); },
  'edit-template'({ id }) { const t = S.templateById(id); if (t) openTemplateEditor(t); },
  'save-as-template'({ wid }) {
    const w = S.workoutById(wid);
    if (w) openTemplateEditor(null, w.entries.map((e) => e.exerciseId).filter((id) => S.exerciseById(id)));
  },
  'tpl-add'({ xid }) { tplDraft.exerciseIds.push(xid); renderTemplateEditor(); },
  'tpl-remove'({ i }) { tplDraft.exerciseIds.splice(Number(i), 1); renderTemplateEditor(); },
  'tpl-move'({ i, dir }) {
    const a = tplDraft.exerciseIds, x = Number(i), y = x + Number(dir);
    if (y < 0 || y >= a.length) return;
    [a[x], a[y]] = [a[y], a[x]];
    renderTemplateEditor();
  },
  'tpl-delete'() {
    const t = S.templateById(tplDraft.id);
    if (!t || !confirm(`Видалити шаблон «${t.name}»? Тренування, вже записані з нього, залишаться.`)) return;
    S.mutate((d) => { d.templates = d.templates.filter((x) => x.id !== t.id); });
    closeModal(); render(); toast('Шаблон видалено');
  },
  'start-template'({ id }) {
    const t = S.templateById(id);
    if (!t || S.activeWorkout()) return;
    const entries = t.exerciseIds
      .filter((xid) => { const x = S.exerciseById(xid); return x && !x.archived; })
      .map((xid) => ({ id: S.uid(), exerciseId: xid, sets: [] }));
    S.mutate((d) => d.workouts.push({ id: S.uid(), startedAt: nowIso(), finishedAt: null, note: '', entries }));
    render();
    window.scrollTo(0, 0);
    toast(`Почато: ${t.name}`);
  },

  'cal-month'({ dir }) {
    const m = state.stats.month;
    state.stats.month = new Date(m.getFullYear(), m.getMonth() + Number(dir), 1);
    state.stats.day = null;
    render();
  },
  'cal-day'({ key }) { state.stats.day = state.stats.day === key ? null : key; render(); },
  'stats-metric'({ v }) { state.stats.metric = v; render(); },
  'stats-period'({ v }) { state.stats.period = v; render(); },
  'stats-table'() { state.stats.table = !state.stats.table; render(); },

  export: doExport,
  import() { importInput.click(); },
};

const forms = {
  'add-set'(f, fd) {
    const { wid, eid } = f.dataset;
    const e = findEntry(wid, eid);
    if (!e) return;
    const r = readSet(exType(e.exerciseId), fd);
    if (r.error) return toast(r.error);
    const sid = S.uid();
    S.mutate(() => e.sets.push({ id: sid, ...r.set, at: nowIso() }));
    render();
    document.querySelector(`.entry[data-eid="${CSS.escape(eid)}"]`)?.scrollIntoView({ block: 'nearest' });
    const pr = ST.prFlags(S.workoutById(wid), e, exType(e.exerciseId)).get(sid);
    if (pr) toast(`🏆 Новий рекорд: ${pr.join(', ')}!`, 3000);
  },
  'edit-set'(f, fd) {
    const { wid, eid, sid } = f.dataset;
    const e = findEntry(wid, eid), s = e?.sets.find((s) => s.id === sid);
    if (!s) return;
    const r = readSet(exType(e.exerciseId), fd);
    if (r.error) return toast(r.error);
    S.mutate(() => Object.assign(s, r.set));
    closeModal();
    render();
  },
  'workout-meta'(f, fd) {
    const w = S.workoutById(f.dataset.wid);
    if (!w) return;
    const start = fromLocalInput(fd.get('start'));
    const end = w.finishedAt ? fromLocalInput(fd.get('end')) : null;
    if (!start) return toast('Вкажи дату початку');
    if (w.finishedAt && (!end || Date.parse(end) < Date.parse(start))) return toast('Кінець не може бути раніше за початок');
    if (Date.parse(start) > Date.now() + 60e3) return toast('Дата не може бути в майбутньому');
    S.mutate(() => {
      w.startedAt = start;
      if (end) w.finishedAt = end;
      w.note = String(fd.get('note') || '').trim();
    });
    closeModal();
    render();
  },
  'past-workout'(f, fd) {
    const start = fromLocalInput(fd.get('start')), end = fromLocalInput(fd.get('end'));
    if (!start || !end) return toast('Вкажи дату і час');
    if (Date.parse(end) < Date.parse(start)) return toast('Кінець не може бути раніше за початок');
    if (Date.parse(start) > Date.now() + 60e3) return toast('Дата не може бути в майбутньому');
    const id = S.uid();
    S.mutate((d) => d.workouts.push({ id, startedAt: start, finishedAt: end, note: '', entries: [] }));
    closeModal();
    state.tab = 'history'; state.detailId = id;
    render();
  },
  exercise(f, fd) {
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name) return toast('Впиши назву');
    const { id, wid } = f.dataset;
    const dup = S.get().exercises.find((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
    if (dup) return toast(dup.archived ? 'Така вправа вже є серед схованих (вкладка «Вправи»)' : 'Вправа з такою назвою вже є');
    const type = S.TYPES[fd.get('type')] ? fd.get('type') : 'strength';
    const groups = fd.getAll('g').map(String);
    let newEid = null;
    S.mutate((d) => {
      if (id) {
        const x = S.exerciseById(id);
        x.name = name; x.muscleGroupIds = groups;
        if (!S.exerciseUsage().get(id)) x.type = type;
      } else {
        const xid = S.uid();
        d.exercises.push({ id: xid, name, type, muscleGroupIds: groups, archived: false, createdAt: nowIso() });
        const w = wid && S.workoutById(wid);
        if (w) { newEid = S.uid(); w.entries.push({ id: newEid, exerciseId: xid, sets: [] }); }
      }
    });
    closeModal();
    render();
    if (newEid) focusEntry(newEid);
    else toast(id ? 'Збережено' : 'Вправу створено');
  },
  template(f, fd) {
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name) return toast('Впиши назву шаблону');
    if (!tplDraft.exerciseIds.length) return toast('Додай хоча б одну вправу');
    if (S.get().templates.some((t) => t.id !== tplDraft.id && t.name.toLowerCase() === name.toLowerCase())) return toast('Шаблон з такою назвою вже є');
    const isNew = !tplDraft.id;
    S.mutate((d) => {
      if (isNew) d.templates.push({ id: S.uid(), name, exerciseIds: [...tplDraft.exerciseIds] });
      else Object.assign(S.templateById(tplDraft.id), { name, exerciseIds: [...tplDraft.exerciseIds] });
    });
    closeModal(); render(); toast(isNew ? 'Шаблон створено' : 'Шаблон збережено');
  },
  group(f, fd) {
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name) return toast('Впиши назву');
    const { id } = f.dataset;
    if (S.get().muscleGroups.some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) return toast('Така група вже є');
    S.mutate((d) => {
      if (id) S.groupById(id).name = name;
      else d.muscleGroups.push({ id: S.uid(), name });
    });
    closeModal();
    render();
  },
};

// ====================================================================
// Експорт / імпорт
// ====================================================================

function markBackup() {
  S.mutate((d) => { d.settings.lastBackupAt = nowIso(); });
  render();
  toast('Резервну копію створено ✓');
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function doExport() {
  const file = new File([S.exportJson()], `gym-backup-${localDateKey()}.json`, { type: 'application/json' });
  const touch = matchMedia('(pointer: coarse)').matches;
  // На телефоні — системне меню «Поділитися», на комп'ютері — звичайне завантаження.
  if (touch && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Резервна копія тренувань' })
      .then(markBackup)
      .catch((e) => { if (e.name !== 'AbortError') { downloadFile(file); markBackup(); } });
  } else {
    downloadFile(file);
    markBackup();
  }
}

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  let nd;
  try { nd = S.parseImport(await file.text()); }
  catch (e) { return alert(`Не вдалося імпортувати: ${e.message}.`); }
  const sets = S.countSets(nd.workouts);
  const ok = confirm(`У файлі: ${nd.exercises.length} ${plural(nd.exercises.length, 'вправа', 'вправи', 'вправ')}, ${nd.workouts.length} ${plural(nd.workouts.length, 'тренування', 'тренування', 'тренувань')}, ${sets} ${plural(sets, 'підхід', 'підходи', 'підходів')}.\n\nУсі поточні дані буде ЗАМІНЕНО даними з файлу. Продовжити?`);
  if (!ok) return;
  S.replaceAll(nd);
  state.detailId = null;
  render();
  toast('Дані імпортовано ✓');
});

// ====================================================================
// Події
// ====================================================================

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const fn = actions[t.dataset.action];
  if (fn) { e.preventDefault(); fn({ ...t.dataset }); }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset?.change === 'stats-ex') {
    state.stats.exId = e.target.value;
    state.stats.metric = null;
    render();
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(f, new FormData(f));
});

modal.addEventListener('input', (e) => {
  if (e.target.id === 'pick-search') $('#pick-list').innerHTML = pickList(e.target.value, e.target.dataset.wid);
  if (e.target.id === 'tpl-name') tplDraft.name = e.target.value;
  if (e.target.id === 'tpl-search') { tplQuery = e.target.value; $('#tpl-avail').innerHTML = tplAvailable(); }
});
modal.addEventListener('keydown', (e) => {
  if (e.target.id === 'tpl-search' && e.key === 'Enter') { e.preventDefault(); return; }
  // Enter у пошуку: якщо знайдено рівно одну вправу — додати її, інакше створити нову.
  if (e.target.id !== 'pick-search' || e.key !== 'Enter') return;
  e.preventDefault();
  const picks = modal.querySelectorAll('[data-action="pick-exercise"]');
  (picks.length === 1 ? picks[0] : modal.querySelector('[data-action="new-exercise"]'))?.click();
});

// ====================================================================
// Старт
// ====================================================================

const loadResult = S.load();
S.setSaveErrorHandler(() => toast('⚠️ Не вдалося зберегти дані! Зроби експорт.', 6000));
navigator.storage?.persist?.().catch(() => {});
render();
if (loadResult.error) setTimeout(() => alert(loadResult.error), 300);
