// store.js — 状態・localStorage永続化・スキーマ(schema:1)
// トリップ文書のファイル契約(監督者確定 2026-07-27・変更時はデータrepoのREADMEも更新):
//   データrepo(private)の trips/index.json = [{id,title,start,end,updatedAt}]
//   trips/<id>.json = 下記 tripDoc 形式。未知フィールドは無視し欠損はデフォルト補完(寛容パース)

const LS_SETTINGS = "tsplus_settings";
const LS_TRIPS = "tsplus_trips";
const EDIT_LOG_MAX = 50;

export const state = {
  settings: { memberName: "", token: "", dataRepo: "kojit1229/tabi-shiori-data" },
  trips: {},          // id -> tripDoc
  currentTripId: null,
  currentDay: 0,
  packingViewer: null,
  recordDay: null,
  recordDayInit: null,
  sync: { st: "notoken", msg: "同期は未設定(ローカル保存で動作中)" },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function nowIso() { return new Date().toISOString(); }

export function loadAll() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}");
    Object.assign(state.settings, s);
  } catch { /* 壊れた設定は初期値のまま */ }
  try {
    state.trips = JSON.parse(localStorage.getItem(LS_TRIPS) || "{}") || {};
  } catch { state.trips = {}; }
  for (const t of Object.values(state.trips)) normalizeTrip(t);
}

export function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}

export function saveTrips() {
  localStorage.setItem(LS_TRIPS, JSON.stringify(state.trips));
}

// 欠損・不正な型をデフォルト補完(寛容パース)。days:[null] 等の壊れた文書でも例外を出さない
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

export function normalizeTrip(t) {
  t.schema = t.schema || 1;
  t.title = typeof t.title === "string" && t.title ? t.title : "無題の旅";
  t.members = Array.isArray(t.members) ? t.members.filter(m => typeof m === "string") : [];
  t.days = Array.isArray(t.days) ? t.days.filter(isObj) : [];
  for (const d of t.days) {
    d.items = Array.isArray(d.items) ? d.items.filter(isObj) : [];
    for (const it of d.items) {
      // 写真参照はパス形式まで検証(同期文書経由で任意パスをAPIへ投げさせない)
      it.photos = Array.isArray(it.photos)
        ? it.photos.filter(p => isObj(p) && typeof p.id === "string"
            && typeof p.path === "string" && /^photos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.jpg$/.test(p.path))
        : [];
    }
  }
  t.packing = isObj(t.packing) ? t.packing : {};
  t.packing.shared = Array.isArray(t.packing.shared) ? t.packing.shared.filter(isObj) : [];
  t.packing.personal = isObj(t.packing.personal) ? t.packing.personal : {};
  for (const k of Object.keys(t.packing.personal)) {
    t.packing.personal[k] = Array.isArray(t.packing.personal[k])
      ? t.packing.personal[k].filter(isObj) : [];
  }
  t.editLog = Array.isArray(t.editLog) ? t.editLog.filter(isObj) : [];
  t.updatedAt = typeof t.updatedAt === "string" ? t.updatedAt : nowIso();
  return t;
}

// ローカルタイムゾーンで YYYY-MM-DD を組み立てる(toISOStringはUTC変換で日付がずれるため不可)
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// start〜end の日付配列を生成(不正な期間は開始日のみ)
export function dateRange(start, end) {
  const out = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (isNaN(s)) return out;
  let d = s;
  for (let i = 0; i < 30 && d <= (isNaN(e) ? s : e); i++) {
    out.push(ymd(d));
    d = new Date(d.getTime() + 86400000);
  }
  return out.length ? out : [start];
}

export function createTrip({ title, start, end, members }) {
  // 日本語タイトルはslugが空になるため、既存IDと衝突したら乱数を足して一意化する
  let id = slugify(title) + "-" + start.replaceAll("-", "").slice(0, 8);
  while (state.trips[id]) id += "-" + Math.random().toString(36).slice(2, 6);
  const trip = normalizeTrip({
    schema: 1, id, title, start, end,
    members,
    days: dateRange(start, end).map(date => ({ date, items: [] })),
    packing: { shared: [], personal: {} },
    editLog: [], updatedAt: nowIso(), updatedBy: state.settings.memberName || "",
  });
  state.trips[id] = trip;
  logEdit(trip, "旅を作成");
  saveTrips();
  return trip;
}

function slugify(s) {
  const a = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return a || "trip";
}

export function logEdit(trip, action) {
  trip.editLog.push({ at: nowIso(), by: state.settings.memberName || "(名前未設定)", action });
  if (trip.editLog.length > EDIT_LOG_MAX) trip.editLog = trip.editLog.slice(-EDIT_LOG_MAX);
  trip.updatedAt = nowIso();
  trip.updatedBy = state.settings.memberName || "";
}

// 一覧表示用メタ(ローカル導出)
export function tripIndex() {
  return Object.values(state.trips)
    .map(t => ({ id: t.id, title: t.title, start: t.start, end: t.end, updatedAt: t.updatedAt }))
    .sort((a, b) => (b.start || "").localeCompare(a.start || ""));
}

export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  const w = "日月火水木金土"[dt.getDay()];
  return `${dt.getMonth() + 1}/${dt.getDate()}(${w})`;
}

export function daysUntil(d) {
  const t = new Date(d + "T00:00:00") - new Date(new Date().toDateString());
  return Math.ceil(t / 86400000);
}
