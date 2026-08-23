import { getRegion } from './registries';

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** GPS fix if present, else the region centroid — a GPS-less farmer still gets matched. */
export function resolvePoint(gpsLat: number | null, gpsLng: number | null, regionCode: string): GeoPoint {
  if (gpsLat !== null && gpsLng !== null) return { lat: gpsLat, lng: gpsLng };
  const region = getRegion(regionCode);
  return { lat: region.lat, lng: region.lng };
}
