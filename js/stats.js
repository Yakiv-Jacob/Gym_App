// Обчислення статистики: показники для графіків, рекорди, позначки 🏆.
import * as S from './store.js';
import { fmtNum, fmtDuration } from './util.js';

/** Орієнтовний максимум на 1 повторення (формула Еплі) */
export const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

const max = (a) => (a.length ? Math.max(...a) : null);
const min = (a) => (a.length ? Math.min(...a) : null);
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const paceOf = (sets) => {
  const ok = sets.filter((x) => x.distance && x.duration);
  const d = sum(ok.map((x) => x.distance));
  return d ? sum(ok.map((x) => x.duration)) / d : null;
};

/** Що можна показати на графіку для кожного типу вправи. f(sets одного тренування) -> число */
export const METRICS = {
  strength: [
    { id: 'maxWeight', label: 'Макс. вага', unit: 'кг', f: (s) => max(s.map((x) => x.weight)) },
    { id: 'e1rm', label: '1ПМ (оцінка)', unit: 'кг', f: (s) => max(s.map((x) => e1rm(x.weight, x.reps))) },
    {
      id: 'rel', label: '1ПМ ÷ вага тіла', ratio: true,
      f: (s, w) => { const bw = bodyWeightAt(Date.parse(w.startedAt)); return bw ? max(s.map((x) => e1rm(x.weight, x.reps))) / bw : null; },
    },
    { id: 'tonnage', label: 'Тоннаж', unit: 'кг', f: (s) => sum(s.map((x) => x.weight * x.reps)) },
    { id: 'sets', label: 'Підходи', int: true, f: (s) => s.length },
    { id: 'reps', label: 'Повторення', int: true, f: (s) => sum(s.map((x) => x.reps)) },
  ],
  bodyweight: [
    { id: 'maxReps', label: 'Макс. повторень', int: true, f: (s) => max(s.map((x) => x.reps)) },
    { id: 'reps', label: 'Всього повторень', int: true, f: (s) => sum(s.map((x) => x.reps)) },
    { id: 'sets', label: 'Підходи', int: true, f: (s) => s.length },
    { id: 'maxExtra', label: 'Дод. вага', unit: 'кг', f: (s) => max(s.map((x) => x.weight).filter(Boolean)) },
  ],
  cardio: [
    { id: 'distance', label: 'Дистанція', unit: 'км', f: (s) => sum(s.map((x) => x.distance)) || null },
    { id: 'duration', label: 'Час', dur: true, f: (s) => sum(s.map((x) => x.duration)) || null },
    { id: 'pace', label: 'Темп', dur: true, perKm: true, lowerBetter: true, f: paceOf },
  ],
  time: [
    { id: 'maxDuration', label: 'Найдовший підхід', dur: true, f: (s) => max(s.map((x) => x.duration)) },
    { id: 'duration', label: 'Загальний час', dur: true, f: (s) => sum(s.map((x) => x.duration)) || null },
    { id: 'sets', label: 'Підходи', int: true, f: (s) => s.length },
  ],
};

export function fmtMetric(m, v) {
  if (v == null) return '—';
  if (m.ratio) return `${fmtNum(Math.round(v * 100) / 100)}×`;
  if (m.dur) return fmtDuration(v) + (m.perKm ? ' /км' : '');
  return fmtNum(Math.round(v * 10) / 10) + (m.unit ? ` ${m.unit}` : '');
}

/** Тренування з цією вправою (від старих до нових) з усіма її підходами в кожному */
export function sessions(exerciseId) {
  const out = [];
  for (const w of S.get().workouts) {
    const sets = w.entries.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
    if (sets.length) out.push({ w, sets, t: Date.parse(w.startedAt) });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function series(exerciseId, metric, sinceMs = 0) {
  return sessions(exerciseId)
    .filter((s) => s.t >= sinceMs)
    .map((s) => ({ t: s.t, v: metric.f(s.sets, s.w), wid: s.w.id }))
    .filter((p) => p.v != null && Number.isFinite(p.v));
}

/** Особисті рекорди вправи: [{label, value, sub, wid, at}] */
export function records(exerciseId, type) {
  const ss = sessions(exerciseId);
  if (!ss.length) return [];
  const bestSet = (score, lower = false) => {
    let best = null;
    for (const s of ss) for (const x of s.sets) {
      const v = score(x);
      if (v == null) continue;
      if (!best || (lower ? v < best.v : v > best.v)) best = { v, x, s };
    }
    return best;
  };
  const bestSession = (score) => {
    let best = null;
    for (const s of ss) { const v = score(s.sets); if (v != null && (!best || v > best.v)) best = { v, s }; }
    return best;
  };
  const rec = (label, b, value, sub = '') => (b ? { label, value, sub, wid: b.s.w.id, at: b.s.w.startedAt } : null);
  const kg = (v) => `${fmtNum(Math.round(v * 10) / 10)} кг`;
  let list = [];

  if (type === 'strength') {
    const w = bestSet((x) => x.weight), r1 = bestSet((x) => e1rm(x.weight, x.reps));
    const ton = bestSession((s) => sum(s.map((x) => x.weight * x.reps)));
    const reps = bestSet((x) => x.reps);
    list = [
      rec('Макс. вага', w, w && kg(w.v), w && `× ${w.x.reps}`),
      rec('1ПМ (оцінка)', r1, r1 && kg(r1.v), r1 && `з ${fmtNum(r1.x.weight)}×${r1.x.reps}`),
      rec('Тоннаж за тренування', ton, ton && kg(ton.v)),
      rec('Макс. повторень', reps, reps && `${reps.v}`, reps && `з ${fmtNum(reps.x.weight)} кг`),
    ];
  } else if (type === 'bodyweight') {
    const reps = bestSet((x) => x.reps);
    const tot = bestSession((s) => sum(s.map((x) => x.reps)));
    const extra = bestSet((x) => x.weight || null);
    list = [
      rec('Макс. повторень', reps, reps && `${reps.v}`),
      rec('Повторень за тренування', tot, tot && `${tot.v}`),
      rec('Макс. дод. вага', extra, extra && `+${kg(extra.v)}`, extra && `× ${extra.x.reps}`),
    ];
  } else if (type === 'cardio') {
    const d = bestSet((x) => x.distance), t = bestSet((x) => x.duration);
    const p = bestSet((x) => (x.distance >= 1 && x.duration ? x.duration / x.distance : null), true);
    list = [
      rec('Найдовша дистанція', d, d && `${fmtNum(d.v)} км`),
      rec('Найдовше за часом', t, t && fmtDuration(t.v)),
      rec('Найкращий темп', p, p && `${fmtDuration(p.v)} /км`, p && `на ${fmtNum(p.x.distance)} км`),
    ];
  } else {
    const t = bestSet((x) => x.duration);
    list = [rec('Найдовший підхід', t, t && fmtDuration(t.v))];
  }
  return list.filter(Boolean);
}

// ---------- Позначки 🏆 на підходах ----------

const PR_CHECKS = {
  strength: [{ label: 'вага', v: (s) => s.weight }, { label: '1ПМ', v: (s) => e1rm(s.weight, s.reps) }],
  bodyweight: [{ label: 'повторення', v: (s) => s.reps }],
  cardio: [
    { label: 'дистанція', v: (s) => s.distance },
    { label: 'темп', lower: true, v: (s) => (s.distance >= 1 && s.duration ? s.duration / s.distance : null) },
  ],
  time: [{ label: 'час', v: (s) => s.duration }],
};

/**
 * Які підходи цього запису були рекордами на момент виконання.
 * Порівнюємо з усіма попередніми тренуваннями та попередніми підходами цього тренування.
 * Перше в історії виконання вправи рекордом не вважається.
 * Повертає Map(setId -> ['вага', '1ПМ', ...]).
 */
export function prFlags(workout, entry, type) {
  const prior = [];
  const t0 = Date.parse(workout.startedAt);
  for (const w of S.get().workouts) {
    if (w.id === workout.id || Date.parse(w.startedAt) >= t0) continue;
    for (const e of w.entries) if (e.exerciseId === entry.exerciseId) prior.push(...e.sets);
  }
  for (const e of workout.entries) {
    if (e === entry) break;
    if (e.exerciseId === entry.exerciseId) prior.push(...e.sets);
  }
  const flags = new Map();
  if (!prior.length) return flags;
  const checks = PR_CHECKS[type] || [];
  const best = checks.map((c) => {
    const vals = prior.map(c.v).filter((v) => v != null);
    return c.lower ? min(vals) : max(vals);
  });
  for (const s of entry.sets) {
    const got = [];
    checks.forEach((c, i) => {
      const v = c.v(s);
      if (v == null) return;
      if (best[i] == null) { best[i] = v; return; }
      if (c.lower ? v < best[i] - 1e-9 : v > best[i] + 1e-9) { got.push(c.label); best[i] = v; }
    });
    if (got.length) flags.set(s.id, got);
  }
  return flags;
}

// ---------- Регулярність ----------

/** Понеділок (00:00 місцевого часу) тижня, до якого належить дата */
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Останні n тижнів: [{start: Date, v}], v = сума valueOf(workout) за тиждень */
export function weeklyBuckets(n, valueOf) {
  const cur = weekStart();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(cur);
    s.setDate(s.getDate() - 7 * i);
    out.push({ start: s, v: 0 });
  }
  const idx = new Map(out.map((b, i) => [b.start.getTime(), i]));
  for (const w of S.get().workouts) {
    const i = idx.get(weekStart(new Date(w.startedAt)).getTime());
    if (i != null) out[i].v += valueOf(w);
  }
  return out;
}

/** Серія тижнів поспіль, у кожному з яких було хоча б одне тренування */
export function weekStreaks() {
  const weeks = new Set(S.get().workouts.map((w) => weekStart(new Date(w.startedAt)).getTime()));
  const cur = weekStart();
  const thisWeek = weeks.has(cur.getTime());
  let current = 0;
  const d = new Date(cur);
  if (!thisWeek) d.setDate(d.getDate() - 7); // поточний тиждень ще не закінчився — серія не перервана
  while (weeks.has(d.getTime())) { current++; d.setDate(d.getDate() - 7); }
  let best = 0, run = 0, prev = null;
  for (const t of [...weeks].sort((a, b) => a - b)) {
    if (prev != null) { const p = new Date(prev); p.setDate(p.getDate() + 7); run = p.getTime() === t ? run + 1 : 1; }
    else run = 1;
    best = Math.max(best, run);
    prev = t;
  }
  return { current, best, thisWeek };
}

/** Кількість підходів по групах м'язів з дати sinceMs */
export function groupSets(sinceMs) {
  const m = new Map();
  let none = 0;
  for (const w of S.get().workouts) {
    if (Date.parse(w.startedAt) < sinceMs) continue;
    for (const e of w.entries) {
      const x = S.exerciseById(e.exerciseId);
      if (!x || !e.sets.length) continue;
      const gs = x.muscleGroupIds.filter((id) => S.groupById(id));
      if (!gs.length) none += e.sets.length;
      for (const g of gs) m.set(g, (m.get(g) || 0) + e.sets.length);
    }
  }
  const list = [...m].map(([id, v]) => ({ name: S.groupById(id).name, v })).sort((a, b) => b.v - a.v);
  return { list, none };
}

// ---------- Кардіо ----------

const isCardio = (e) => S.exerciseById(e.exerciseId)?.type === 'cardio';
export const cardioDist = (w) => sum(w.entries.filter(isCardio).flatMap((e) => e.sets.map((s) => s.distance)));

export function cardioTotals(sinceMs) {
  let dist = 0, dur = 0;
  const by = new Map();
  for (const w of S.get().workouts) {
    if (Date.parse(w.startedAt) < sinceMs) continue;
    const seen = new Set();
    for (const e of w.entries.filter(isCardio)) {
      const d = sum(e.sets.map((s) => s.distance)), t = sum(e.sets.map((s) => s.duration));
      dist += d; dur += t;
      const r = by.get(e.exerciseId) || { name: S.exerciseById(e.exerciseId).name, dist: 0, dur: 0, count: 0 };
      r.dist += d; r.dur += t;
      if (!seen.has(e.exerciseId)) { r.count++; seen.add(e.exerciseId); }
      by.set(e.exerciseId, r);
    }
  }
  return { dist, dur, byEx: [...by.values()].sort((a, b) => b.dist - a.dist) };
}

// ---------- Вага тіла ----------

const DAY = 864e5;
export const dayMs = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export const bwSorted = () => S.get().bodyWeights.slice().sort((a, b) => a.date.localeCompare(b.date));

/** Середнє записів за 7 днів, що закінчуються в момент t */
export function bwAvg7(t) {
  const win = S.get().bodyWeights.filter((b) => { const x = dayMs(b.date); return x <= t && x > t - 7 * DAY; });
  return win.length ? sum(win.map((b) => b.weight)) / win.length : null;
}

/** Вага тіла на дату: останній запис не пізніше t, інакше найперший запис */
export function bodyWeightAt(t) {
  const list = bwSorted();
  if (!list.length) return null;
  let found = null;
  for (const b of list) { if (dayMs(b.date) <= t) found = b; else break; }
  return (found || list[0]).weight;
}

/** Точки для графіка: записи та 7-денне середнє (однакова довжина й порядок) */
export function bwSeries(sinceMs) {
  const all = bwSorted().map((b) => ({ t: dayMs(b.date), v: b.weight, id: b.id }));
  const keep = all.filter((p) => p.t >= sinceMs);
  return { pts: keep, avg: keep.map((p) => ({ t: p.t, v: bwAvg7(p.t + DAY / 2) })) };
}
