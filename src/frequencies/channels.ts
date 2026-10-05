/** Manual channels are kept separately from recomputed published suggestions. */
export function normalizeManualChannels(value: string): string | null {
  const parts = value.trim().split(/[\s,;/]+/).filter(Boolean);
  if (!parts.length || parts.length > 6 || parts.some(p => !/^1[123]\d\.\d{3}$/.test(p) || Number(p) < 118 || Number(p) >= 137)) return null;
  return [...new Set(parts)].join(' / ');
}
