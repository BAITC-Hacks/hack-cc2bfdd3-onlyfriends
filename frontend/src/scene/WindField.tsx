import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry } from 'three';
import { windFlow } from '../forecast/windApi';
import { windStep } from './windMotion';

const STREAKS = 130;
const AREA = 5;

export function WindField({ speed, direction, motion }: { speed: number; direction: number; motion: boolean }) {
  const { geometry, positions } = useMemo(() => {
    const positions = new Float32Array(STREAKS * 6);
    for (let index = 0; index < STREAKS; index++) {
      const offset = index * 6;
      positions[offset] = ((index * 73) % 131) / 131 * AREA * 2 - AREA;
      positions[offset + 1] = 0.25 + ((index * 47) % 89) / 89 * 1.1;
      positions[offset + 2] = ((index * 41) % 127) / 127 * AREA * 2 - AREA;
      positions[offset + 3] = positions[offset];
      positions[offset + 4] = positions[offset + 1];
      positions[offset + 5] = positions[offset + 2];
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return { geometry, positions };
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    const [stepX, stepZ] = windStep(speed, direction, motion ? Math.min(delta, 0.05) : 0);
    const [flowX, flowZ] = windFlow(direction);
    const tail = 0.1 + Math.min(speed, 20) * 0.015;
    for (let index = 0; index < STREAKS; index++) {
      const offset = index * 6;
      let x = positions[offset] + stepX, z = positions[offset + 2] + stepZ;
      if (x > AREA) x = -AREA;
      if (x < -AREA) x = AREA;
      if (z > AREA) z = -AREA;
      if (z < -AREA) z = AREA;
      positions[offset] = x;
      positions[offset + 2] = z;
      positions[offset + 3] = x - flowX * tail;
      positions[offset + 4] = positions[offset + 1];
      positions[offset + 5] = z - flowZ * tail;
    }
    geometry.attributes.position.needsUpdate = true;
  });
  return <lineSegments geometry={geometry} frustumCulled={false}><lineBasicMaterial color="#d2f3ef" transparent opacity={Math.min(0.82, 0.3 + speed * 0.05)} depthWrite={false} /></lineSegments>;
}
