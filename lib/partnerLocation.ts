// Tiny utility around `partner_locations`. Each user writes their own row;
// home-screen compass reads the partner's row + computes bearing/distance.

import { db, queueSyncOperation } from './db';

export interface PartnerLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
}

export const recordOwnLocation = (userId: string, latitude: number, longitude: number, accuracy?: number) => {
  if (!userId || !isFinite(latitude) || !isFinite(longitude)) return;
  const now = new Date().toISOString();
  try {
    db.runSync(
      `INSERT OR REPLACE INTO partner_locations (user_id, latitude, longitude, accuracy, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [userId, latitude, longitude, accuracy ?? null, now]
    );
    queueSyncOperation('partner_locations', userId, 'INSERT', {
      user_id: userId, latitude, longitude, accuracy: accuracy ?? null, updated_at: now,
    });
  } catch {}
};

export const getPartnerLocation = (partnerUserId: string): PartnerLocation | null => {
  if (!partnerUserId) return null;
  try {
    const r = db.getFirstSync(`SELECT * FROM partner_locations WHERE user_id = ?`, [partnerUserId]) as any;
    if (!r) return null;
    return r as PartnerLocation;
  } catch { return null; }
};

// Initial bearing (degrees from north) from point A → point B.
export const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

// Haversine distance in metres.
export const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export const formatDistance = (m: number): string => {
  if (!isFinite(m) || m < 0) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
};

export const ago = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
