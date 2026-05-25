// Internal user keys → display names. Backend / DB still uses the internal
// keys ('pratishth' / 'love') everywhere — this helper only affects what the
// UI shows. Add overrides here, no other code change needed.

const MAP: Record<string, string> = {
  pratishth: 'Roy',
  love: 'Supriya',
  both: 'Both',
};

export function displayName(key: string | null | undefined): string {
  if (!key) return '';
  const norm = key.trim().toLowerCase();
  return MAP[norm] || (norm.charAt(0).toUpperCase() + norm.slice(1));
}
