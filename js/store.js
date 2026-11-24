// Зберігання даних. Усе лежить у localStorage телефона одним JSON-об'єктом.
// Структура (вона ж — формат файлу резервної копії):
// {
//   version, muscleGroups: [{id, name}],
//   exercises: [{id, name, type, muscleGroupIds, archived, createdAt}],
//   workouts: [{id, startedAt, finishedAt, note, entries: [{id, exerciseId, sets: [{id, weight, reps, distance, duration, at}]}]}],
//   templates: [{id, name, exerciseIds}],
//   bodyWeights: [{id, date: 'YYYY-MM-DD', weight}], settings: {lastBackupAt, goalWeight}
// }
// weight — кг, distance — км, duration — секунди. Невикористані поля = null.

const KEY = 'gym-log:data';
const SAFETY_KEY = 'gym-log:before-import';
const CORRUPT_KEY = 'gym-log:corrupt';
export const SCHEMA_VERSION = 1;

export const TYPES = {
  strength: { label: 'Сила', hint: 'вага × повторення' },
  bodyweight: { label: 'Власна вага', hint: 'повторення (+ дод. вага)' },
  cardio: { label: 'Кардіо', hint: 'дистанція і час' },
  time: { label: 'На час', hint: 'тривалість' },
};

const DEFAULT_GROUPS = ['Груди', 'Спина', 'Ноги', 'Плечі', 'Біцепс', 'Трицепс', 'Прес', 'Кардіо'];

let data = null;
let onSaveError = null;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function emptyData() {
  return {
    version: SCHEMA_VERSION,
    muscleGroups: DEFAULT_GROUPS.map((name) => ({ id: uid(), name })),
    exercises: [],
    workouts: [],
    bodyWeights: [],
    templates: [],
    settings: { lastBackupAt: null, goalWeight: null },
  };
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { console.error(e); }
  if (!raw) { data = emptyData(); return {}; }
  try {
    data = normalize(JSON.parse(raw));
    return {};
  } catch (e) {
    // Ніколи не затираємо пошкоджені дані — відкладаємо їх копію.
    try { localStorage.setItem(`${CORRUPT_KEY}:${Date.now()}`, raw); } catch {}
    data = emptyData();
    return { error: 'Не вдалося прочитати збережені дані. Їхню копію відкладено. Відновити дані можна з файлу резервної копії (Ще → Імпорт).' };
  }
}

export const setSaveErrorHandler = (fn) => { onSaveError = fn; };

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(e);
    onSaveError?.(e);
    return false;
  }
}

export const get = () => data;

/** Змінити дані й одразу зберегти */
export function mutate(fn) { fn(data); save(); }

// ---------- Перевірка/приведення формату (і для localStorage, і для імпорту) ----------

const isDate = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normalize(d) {
  if (!d || typeof d !== 'object') throw new Error('файл не схожий на резервну копію цієї програми');
  if (!Array.isArray(d.exercises) || !Array.isArray(d.workouts)) throw new Error('у файлі немає списку вправ або тренувань');
  return {
    version: SCHEMA_VERSION,
    muscleGroups: (Array.isArray(d.muscleGroups) ? d.muscleGroups : [])
      .filter((g) => g && g.id && g.name)
      .map((g) => ({ id: String(g.id), name: String(g.name) })),
    exercises: d.exercises
      .filter((x) => x && x.id && x.name)
      .map((x) => ({
        id: String(x.id),
        name: String(x.name),
        type: TYPES[x.type] ? x.type : 'strength',
        muscleGroupIds: Array.isArray(x.muscleGroupIds) ? x.muscleGroupIds.map(String) : [],
        archived: !!x.archived,
        createdAt: isDate(x.createdAt) ? x.createdAt : null,
      })),
    workouts: d.workouts
      .filter((w) => w && w.id && isDate(w.startedAt))
      .map((w) => ({
        id: String(w.id),
        startedAt: w.startedAt,
        finishedAt: isDate(w.finishedAt) ? w.finishedAt : null,
        note: typeof w.note === 'string' ? w.note : '',
        entries: (Array.isArray(w.entries) ? w.entries : [])
          .filter((e) => e && e.id && e.exerciseId)
          .map((e) => ({
            id: String(e.id),
            exerciseId: String(e.exerciseId),
            sets: (Array.isArray(e.sets) ? e.sets : [])
              .filter((s) => s && s.id)
              .map((s) => ({
                id: String(s.id),
                weight: num(s.weight),
                reps: num(s.reps),
                distance: num(s.distance),
                duration: num(s.duration),
                at: isDate(s.at) ? s.at : null,
              })),
          })),
      })),
    bodyWeights: (Array.isArray(d.bodyWeights) ? d.bodyWeights : [])
      .filter((b) => b && b.id && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && num(b.weight) > 0)
      .map((b) => ({ id: String(b.id), date: b.date, weight: b.weight })),
    templates: (Array.isArray(d.templates) ? d.templates : [])
      .filter((t) => t && t.id && t.name)
      .map((t) => ({
        id: String(t.id),
        name: String(t.name),
        exerciseIds: Array.isArray(t.exerciseIds) ? t.exerciseIds.map(String) : [],
      })),
    settings: {
      lastBackupAt: isDate(d.settings?.lastBackupAt) ? d.settings.lastBackupAt : null,
      goalWeight: num(d.settings?.goalWeight) > 0 ? d.settings.goalWeight : null,
    },
  };
}

export function parseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('файл пошкоджений або це не JSON'); }
  return normalize(obj);
}

/** Повна заміна даних (імпорт). Попередні дані відкладаються про всяк випадок. */
export function replaceAll(newData) {
  try { localStorage.setItem(SAFETY_KEY, JSON.stringify(data)); } catch {}
  data = newData;
  save();
}

export function exportJson() {
  return JSON.stringify({ app: 'gym-log', exportedAt: new Date().toISOString(), ...data }, null, 2);
}

// ---------- Запити ----------

export const exerciseById = (id) => data.exercises.find((x) => x.id === id);
export const workoutById = (id) => data.workouts.find((w) => w.id === id);
export const groupById = (id) => data.muscleGroups.find((g) => g.id === id);

const byStartDesc = (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt);
export const sortedWorkouts = () => data.workouts.slice().sort(byStartDesc);
export const activeWorkout = () => sortedWorkouts().find((w) => !w.finishedAt) || null;
export const finishedWorkouts = () => sortedWorkouts().filter((w) => w.finishedAt);

/** exerciseId -> {count: у скількох тренуваннях, last: ISO останнього} */
export function exerciseUsage() {
  const m = new Map();
  for (const w of data.workouts) {
    for (const e of w.entries) {
      const u = m.get(e.exerciseId) || { count: 0, last: null };
      u.count++;
      if (!u.last || Date.parse(w.startedAt) > Date.parse(u.last)) u.last = w.startedAt;
      m.set(e.exerciseId, u);
    }
  }
  return m;
}

export const templateById = (id) => data.templates.find((t) => t.id === id);

/** Останнє виконання вправи ДО цього тренування: {w, e} або null */
export function lastPerformance(exerciseId, workout) {
  const before = Date.parse(workout.startedAt);
  let best = null, bestT = -Infinity;
  for (const w of data.workouts) {
    if (w.id === workout.id) continue;
    const t = Date.parse(w.startedAt);
    if (t >= before || t <= bestT) continue;
    const e = w.entries.find((e) => e.exerciseId === exerciseId && e.sets.length);
    if (e) { best = { w, e }; bestT = t; }
  }
  return best;
}

export const countSets =(workouts = data.workouts) =>
  workouts.reduce((a, w) => a + w.entries.reduce((b, e) => b + e.sets.length, 0), 0);
