// photos.js — 代表写真の基盤: 端末内IndexedDB保存・縮小・private repoへのアップロード
// 3層方針: 原本=各自のiCloud写真。アプリが持つのは「選んだ写真の縮小コピー」だけ。
// ファイル契約(監督者確定 2026-07-28): データrepoの photos/<tripId>/<photoId>.jpg
// パスは撮影取込時に確定(決定論)。アップロード前でもtrip文書にはpath入りの参照が載り、
// 他端末は404の間「アップロード待ち」を表示する。

import { uid } from "./store.js";
import { getRawBlob, putBinaryB64 } from "./github.js";

const DB_NAME = "tsplus-photos";
const STORE = "photos";
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;
export const MAX_PHOTOS_PER_ITEM = 4;

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

function getRec(id) {
  return db().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function allRecs() {
  return db().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

// 画像を長辺MAX_EDGEに縮小したJPEG Blobへ変換
export async function resizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("画像を読み込めません"));
      i.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("画像を変換できません");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 選択ファイル群を縮小して取り込む。1枚の失敗で全体を落とさず、
// 成功分の参照(refs)と失敗枚数を必ず返す(IndexedDBに参照なしの孤児を残さない)
export async function capturePhotos(fileList, tripId) {
  const refs = [];
  let failed = 0;
  for (const file of [...fileList]) {
    try {
      if (!/^image\//.test(file.type)) throw new Error("画像以外");
      const blob = await resizeImage(file);
      const id = uid();
      const path = `photos/${tripId}/${id}.jpg`;
      await tx("readwrite", s => s.put({ id, tripId, path, blob, uploaded: false, tries: 0, at: Date.now() }));
      refs.push({ id, path });
    } catch { failed++; }
  }
  return { refs, failed };
}

const urlCache = new Map(); // photoId -> Promise<objectURL|null>(並行呼び出しでも生成は1回)

// 表示用URL。端末内(IndexedDB)優先、無ければprivate repoから取得してキャッシュ。
// 未アップロード(404)や取得失敗は null(呼び出し側で「待ち」表示。キャッシュせず後で再試行できる)
export function photoURL(ref, repo, token) {
  if (!urlCache.has(ref.id)) {
    const p = loadPhotoURL(ref, repo, token).catch(() => null).then(url => {
      if (url === null) urlCache.delete(ref.id);
      return url;
    });
    urlCache.set(ref.id, p);
  }
  return urlCache.get(ref.id);
}

async function loadPhotoURL(ref, repo, token) {
  let rec = await getRec(ref.id);
  if (!rec && repo && token) {
    const blob = await getRawBlob(repo, ref.path, token); // 404はnull、オフライン等はthrow→null
    if (blob) {
      rec = { id: ref.id, tripId: ref.path.split("/")[1] || "", path: ref.path, blob, uploaded: true, at: Date.now() };
      await tx("readwrite", s => s.put(rec));
    }
  }
  return rec ? URL.createObjectURL(rec.blob) : null;
}

export async function removeLocalPhoto(id) {
  const p = urlCache.get(id);
  if (p) {
    urlCache.delete(id);
    p.then(u => { if (u) URL.revokeObjectURL(u); }).catch(() => {});
  }
  await tx("readwrite", s => s.delete(id));
}

export async function pendingCount() {
  const recs = await allRecs();
  return recs.filter(r => !r.uploaded && !r.failed).length;
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",", 2)[1] || "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// 未アップロード分をprivate repoへ送る。成功件数を返す。
// 失敗はtriesを数え、3回で諦め(failed)て後続をブロックしない。一時的な失敗は例外→呼び出し側の再試行に乗る
export async function uploadPending(repo, token) {
  const recs = (await allRecs()).filter(r => !r.uploaded && !r.failed);
  let sent = 0;
  for (const r of recs) {
    try {
      const b64 = await blobToB64(r.blob);
      await putBinaryB64(repo, r.path, token, b64, `写真アップロード: ${r.path}`);
      r.uploaded = true;
      await tx("readwrite", s => s.put(r));
      sent++;
    } catch (e) {
      r.tries = (r.tries || 0) + 1;
      if (r.tries >= 3) r.failed = true; // 恒久失敗として除外(無限リトライ防止)
      await tx("readwrite", s => s.put(r));
      if (!r.failed) throw e;
    }
  }
  return sent;
}
