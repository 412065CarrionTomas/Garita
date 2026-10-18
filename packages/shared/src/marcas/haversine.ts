/**
 * Great-circle distance between two geographic points in meters using the Haversine formula.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const EARTH_RADIUS_METERS = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLon2 = Math.sin(dLon / 2);

  const a = sinDLat2 * sinDLat2 + Math.cos(phi1) * Math.cos(phi2) * sinDLon2 * sinDLon2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return EARTH_RADIUS_METERS * c;
}
