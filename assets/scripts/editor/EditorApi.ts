// What the Level Editor exchanges with the outside: the local server (tools/serve.mjs +
// tools/editor-api.mjs) that reads / writes the project files, file downloads and the clipboard.
// These are browser features (the editor is a web build); there is no Cocos equivalent.
import { sys } from 'cc';

const json = async (r: Response) => { if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };

export const EditorApi = {
  /** Is the project's server there (it reads the project files), and may this browser write into it? */
  async server(): Promise<{ ok: boolean; write: boolean }> {
    try { const r = await json(await fetch('/api/ping')); return { ok: r.ok === true, write: r.ok === true && r.write !== false }; }
    catch { return { ok: false, write: false }; }
  },
  /** levels.json as it is in the project now (not the copy built into this web build) */
  async loadLevels(): Promise<any | null> {
    try { return await json(await fetch(`/api/levels?t=${Date.now()}`, { cache: 'no-store' })); } catch { return null; }
  },
  /** Every item manifest as it is in the project now (art library edits made after the build) */
  async loadItems(): Promise<any[]> {
    try { return await json(await fetch(`/api/items?t=${Date.now()}`, { cache: 'no-store' })); } catch { return []; }
  },
  /** Write levels.json into the project (assets/gamecontent/content/cozy/levels.json) */
  async saveLevels(book: any): Promise<void> {
    await json(await fetch('/api/levels', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(book, null, 2) + '\n' }));
  },
  /** Write one item manifest (Art library) and let the server rebuild the item prefab */
  async saveItem(id: number, manifest: any): Promise<any> {
    return json(await fetch(`/api/item/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifest, null, 2) + '\n' }));
  },

  /** Save a text file to the computer (browser download) */
  download(name: string, text: string) {
    if (!sys.isBrowser) return;
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  async copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  },
  /** Clipboard text; when the browser refuses, ask for it in a prompt (null = cancelled) */
  async pasteText(question: string): Promise<string | null> {
    try { const t = await navigator.clipboard.readText(); if (t && t.trim()) return t; } catch { /* refused */ }
    return sys.isBrowser ? window.prompt(question) : null;
  },
  confirm(question: string): boolean { return sys.isBrowser ? window.confirm(question) : true; },
};
