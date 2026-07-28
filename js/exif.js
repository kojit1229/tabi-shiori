// exif.js — JPEGのEXIFから撮影日時(DateTimeOriginal)だけを読む最小パーサ。
// 縮小(canvas)はEXIFを落とすため、取込前の元ファイルから読むこと。
// 失敗・非JPEG・EXIFなしは null を返す(フェイルソフト。呼び出し側で「日付不明」扱い)。

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132; // 予備(DateTimeOriginalが無い画像用)

export async function readShotDateTime(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer(); // EXIFは先頭にある
    return parseShotDateTime(buf);
  } catch {
    return null;
  }
}

// ArrayBuffer から "YYYY:MM:DD HH:MM:SS" を探し {date:"YYYY-MM-DD", time:"HH:MM"} を返す
export function parseShotDateTime(buf) {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // JPEGでない
    // APP1(Exif)セグメントを探す
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && off + 10 <= v.byteLength &&
          v.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
        // 宣言サイズが実バッファ超の壊れ画像でも境界内に収める
        return parseTiff(v, off + 10, Math.min(size - 8, v.byteLength - (off + 10)));
      }
      if ((marker & 0xff00) !== 0xff00) return null; // 壊れたマーカー
      off += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiff(v, base, len) {
  if (len < 8) return null;
  const bom = v.getUint16(base);
  const le = bom === 0x4949; // "II"=リトルエンディアン, "MM"=ビッグ
  if (!le && bom !== 0x4d4d) return null;
  const u16 = (o) => v.getUint16(base + o, le);
  const u32 = (o) => v.getUint32(base + o, le);
  if (u16(2) !== 0x002a) return null;

  const readIfd = (ifdOff, wantTag) => {
    if (ifdOff + 2 > len) return null;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (e + 12 > len) return null;
      if (u16(e) === wantTag) return e;
    }
    return null;
  };

  const asciiAt = (entry) => {
    const count = u32(entry + 4);
    if (count < 10 || count > 64) return null;
    const valOff = count <= 4 ? entry + 8 : u32(entry + 8);
    if (valOff + count > len) return null;
    let s = "";
    for (let i = 0; i < count - 1; i++) s += String.fromCharCode(v.getUint8(base + valOff + i));
    return s;
  };

  const ifd0 = u32(4);
  // ExifIFD内のDateTimeOriginalを優先、無ければIFD0のDateTime
  const exifPtr = readIfd(ifd0, TAG_EXIF_IFD);
  let raw = null;
  if (exifPtr) {
    const dtoEntry = readIfd(u32(exifPtr + 8), TAG_DATETIME_ORIGINAL);
    if (dtoEntry) raw = asciiAt(dtoEntry);
  }
  if (!raw) {
    const dtEntry = readIfd(ifd0, TAG_DATETIME);
    if (dtEntry) raw = asciiAt(dtEntry);
  }
  if (!raw) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}
