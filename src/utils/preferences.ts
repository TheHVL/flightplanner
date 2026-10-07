/** Optional UI preferences must not stop planning when browser storage is denied. */
export function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
