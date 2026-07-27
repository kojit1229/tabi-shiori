// github.js — GitHub Contents API クライアント(データ用private repoの読み書き)
// トークンはfine-grained PAT(対象repoのContents: Read and write のみ)を想定。
// このモジュールはトークンを一切ログ出力しない。

const API = "https://api.github.com";

function headers(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// UTF-8 安全な base64(大きな配列でもスタックを溢れさせないようチャンク処理)
export function encodeB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function decodeB64(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GithubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ファイル取得。404 は null(未作成)として返す。それ以外の失敗は throw。
export async function getFile(repo, path, token) {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    headers: headers(token), cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubError(res.status, `取得失敗 ${res.status}: ${path}`);
  const j = await res.json();
  return { sha: j.sha, text: decodeB64(j.content || "") };
}

// ファイル作成/更新。既存更新には sha 必須(楽観ロック)。409/422 は競合として throw。
export async function putFile(repo, path, token, text, sha, message) {
  const body = { message, content: encodeB64(text) };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method: "PUT", headers: headers(token), body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) {
    throw new GithubError(res.status, `競合: ${path} は他の端末が先に更新`);
  }
  if (!res.ok) throw new GithubError(res.status, `保存失敗 ${res.status}: ${path}`);
  const j = await res.json();
  return j.content ? j.content.sha : null;
}

// JSONファイルの取得(寛容パース: 壊れたJSONは null 扱いにせず throw で気づく)
export async function getJson(repo, path, token) {
  const f = await getFile(repo, path, token);
  if (!f) return null;
  return { sha: f.sha, data: JSON.parse(f.text) };
}

export async function putJson(repo, path, token, data, sha, message) {
  return putFile(repo, path, token, JSON.stringify(data, null, 2), sha, message);
}

// トークン・repo設定の疎通確認(設定画面の「接続テスト」用)
export async function checkAccess(repo, token) {
  const res = await fetch(`${API}/repos/${repo}`, { headers: headers(token), cache: "no-store" });
  if (res.status === 401) return { ok: false, msg: "トークンが無効です" };
  if (res.status === 404) return { ok: false, msg: "リポジトリが見つかりません(トークンの対象repo設定を確認)" };
  if (!res.ok) return { ok: false, msg: `接続エラー ${res.status}` };
  return { ok: true, msg: "接続OK" };
}
