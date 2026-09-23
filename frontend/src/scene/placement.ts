import { Quaternion, Vector3 } from 'three';

export const PLANET_RADIUS = 1.65;
const UP = new Vector3(0, 1, 0);

/** Y-up coordinates; longitude zero faces +Z. Angles are in degrees. */
export function latLonToVector3(lat: number, lon: number, radius: number): Vector3 {
  const phi = lat * Math.PI / 180;
  const theta = lon * Math.PI / 180;
  return new Vector3(radius * Math.cos(phi) * Math.sin(theta), radius * Math.sin(phi), radius * Math.cos(phi) * Math.cos(theta));
}

/** Terrain vertices lie at or inside radius; positive clearance prevents buried bases. */
export function surfacePlacement(lat: number, lon: number, clearance = 0.018) {
  const normal = latLonToVector3(lat, lon, 1);
  return { position: normal.clone().multiplyScalar(PLANET_RADIUS + clearance), quaternion: new Quaternion().setFromUnitVectors(UP, normal) };
}
