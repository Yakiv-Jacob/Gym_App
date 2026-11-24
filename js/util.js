// Дрібні допоміжні функції: форматування чисел, дат, тривалості.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "62,5" / "62.5" -> 62.5; порожньо -> null; сміття -> NaN */
export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const numFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
/** Для показу: 12 345,5 */
export const fmtNum = (n) => (n == null ? '' : numFmt.format(n));
/** Для полів вводу: 62,5 (без пробілів-розділювачів) */
export const fmtIn = (n) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));

const p2 = (n) => String(n).padStart(2, '0');
export function fmtDuration(sec) {
  if (sec == null) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}
export const fmtPace = (secPerKm) => fmtDuration(secPerKm);

export function fmtMinutes(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} год ${m} хв` : `${m} хв`;
}

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
export const fmtMonth = (iso) => { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

const dFmtYear = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const dFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' });
const dShort = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' });
const dShortYear = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
const tFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const sameYear = (d) => d.getFullYear() === new Date().getFullYear();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtDate = (iso) => { const d = new Date(iso); return cap((sameYear(d) ? dFmt : dFmtYear).format(d)); };
export const fmtDateShort = (iso) => { const d = new Date(iso); return (sameYear(d) ? dShort : dShortYear).format(d); };
export const fmtTime = (iso) => tFmt.format(new Date(iso));

/** ISO -> значення для <input type="datetime-local"> у місцевому часі */
export function toLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v); // рядок без часового поясу трактується як місцевий час
  return isNaN(d) ? null : d.toISOString();
}
export const localDateKey = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Українські відмінки: plural(5, 'підхід', 'підходи', 'підходів') */
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
