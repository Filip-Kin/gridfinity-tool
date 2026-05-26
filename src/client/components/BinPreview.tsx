import { useMemo } from "react";
import * as THREE from "three";
import type { BinConfig } from "@shared/types";

interface Props {
  bin: BinConfig;
}

function gridzToInternalHeight(bin: BinConfig): number {
  switch (bin.gridzMode) {
    case "increments":
      return bin.gridz * 7;
    case "internal":
      return bin.gridz + 4.75;
    case "external":
      return bin.gridz;
    case "external-with-lip":
      return Math.max(0, bin.gridz - 3.55);
  }
}

export function BinPreview({ bin }: Props) {
  const w = bin.gridx * 42;
  const d = bin.gridy * 42;
  const h = gridzToInternalHeight(bin);
  const wallT = 1.2;
  const floorT = 1.0;

  const wallsGeom = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w, d);
    shape.lineTo(0, d);
    shape.lineTo(0, 0);
    const hole = new THREE.Path();
    hole.moveTo(wallT, wallT);
    hole.lineTo(w - wallT, wallT);
    hole.lineTo(w - wallT, d - wallT);
    hole.lineTo(wallT, d - wallT);
    hole.lineTo(wallT, wallT);
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, { depth: h - floorT, bevelEnabled: false });
  }, [w, d, h, wallT, floorT]);

  return (
    <group>
      <mesh position={[w / 2, d / 2, floorT / 2]} receiveShadow>
        <boxGeometry args={[w, d, floorT]} />
        <meshStandardMaterial color="#3a4250" transparent opacity={0.35} />
      </mesh>
      <mesh geometry={wallsGeom} position={[0, 0, floorT]}>
        <meshStandardMaterial color="#3a4250" transparent opacity={0.2} />
      </mesh>
      <lineSegments position={[w / 2, d / 2, h / 2 + floorT]}>
        <edgesGeometry args={[new THREE.BoxGeometry(w, d, h)]} />
        <lineBasicMaterial color="#5e9eff" transparent opacity={0.6} />
      </lineSegments>
      {Array.from({ length: bin.gridx - 1 }, (_, i) => (
        <line key={`gx${i}`}>
          <bufferGeometry
            attach="geometry"
            onUpdate={(g) => {
              const x = (i + 1) * 42;
              g.setFromPoints([new THREE.Vector3(x, 0, floorT + 0.01), new THREE.Vector3(x, d, floorT + 0.01)]);
            }}
          />
          <lineBasicMaterial color="#5e9eff" transparent opacity={0.25} />
        </line>
      ))}
      {Array.from({ length: bin.gridy - 1 }, (_, i) => (
        <line key={`gy${i}`}>
          <bufferGeometry
            attach="geometry"
            onUpdate={(g) => {
              const y = (i + 1) * 42;
              g.setFromPoints([new THREE.Vector3(0, y, floorT + 0.01), new THREE.Vector3(w, y, floorT + 0.01)]);
            }}
          />
          <lineBasicMaterial color="#5e9eff" transparent opacity={0.25} />
        </line>
      ))}
    </group>
  );
}
