// Write levels.json straight to GitHub, for an editor opened without the project's local server
// (port of the web editor src/editor/github.js). One file per commit. The token is pasted by the
// user, kept in this browser's localStorage and sent to api.github.com only; a fine-grained token
// with Contents: Read and write on this repo is enough.
import { LocalStore } from '../services/LocalStore';

const API = 'https://api.github.com';
const KEY = 'snug.gh.token';

/** Where the Cocos project lives (branch cocos of the company repo) */
const REPO = { owner: 'Smartmove-Global-Limited', repo: 'Everything-Fits', branch: 'cocos', path: 'assets/gamecontent/content/cozy/levels.json' };

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function call(path: string, init: RequestInit, token: string) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* not JSON */ }
    if (res.status === 401) msg = 'token sai hoặc đã hết hạn';
    if (res.status === 403) msg = 'token không có quyền ghi vào repo này';
    if (res.status === 404) msg = 'không thấy repo hoặc token thiếu quyền Contents';
    if (res.status === 409) msg = 'file vừa bị người khác sửa, tải lại trang rồi thử lại';
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const GitHub = {
  REPO,
  readToken: () => LocalStore.get(KEY) || '',
  writeToken: (t: string) => LocalStore.set(KEY, t),
  clearToken: () => LocalStore.set(KEY, ''),
  hasToken: () => !!LocalStore.get(KEY),

  /** Can this token write to the repo? Returns the repo's full name */
  async check(token: string) {
    const r = await call(`/repos/${REPO.owner}/${REPO.repo}`, {}, token);
    if (!r.permissions?.push) throw new Error('token đọc được repo nhưng không có quyền ghi');
    return r.full_name as string;
  },

  /** levels.json as one commit */
  async putBook(book: any, note = '') {
    const token = GitHub.readToken();
    if (!token) throw new Error('chưa có token');
    const url = `/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(REPO.path)}`;
    let sha: string | undefined;
    try { sha = (await call(`${url}?ref=${REPO.branch}`, {}, token)).sha; } catch { /* new file */ }
    const r = await call(url, {
      method: 'PUT',
      body: JSON.stringify({ message: `content(cozy): sắp xếp level v${book.version}${note ? ' — ' + note : ''}`, content: toBase64(JSON.stringify(book, null, 2) + '\n'), branch: REPO.branch, ...(sha ? { sha } : {}) }),
    }, token);
    return { commit: String(r.commit.sha).slice(0, 7) };
  },
};
