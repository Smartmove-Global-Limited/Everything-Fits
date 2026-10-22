// Small wrapper over sys.localStorage (web localStorage / native key-value store). Never throws:
// a full or blocked store just behaves as empty. Keys match the web game so saves line up.
import { sys } from 'cc';

export const LocalStore = {
  get(key: string): string | null {
    try { return sys.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { sys.localStorage.setItem(key, value); } catch { /* storage full or blocked */ }
  },
  json<T extends object>(key: string, fallback: T): T {
    const s = this.get(key);
    if (!s) return { ...fallback };
    try { const v = JSON.parse(s); return v && typeof v === 'object' ? { ...fallback, ...v } : { ...fallback }; } catch { return { ...fallback }; }
  },
  setJson(key: string, value: unknown) { this.set(key, JSON.stringify(value)); },
};
