import { useStore } from "../lib/store";

export function RenderedBin() {
  const geom = useStore((s) => s.renderGeometry);
  if (!geom) return null;
  return (
    <mesh geometry={geom} castShadow receiveShadow>
      <meshStandardMaterial color="#9bb3d4" metalness={0.15} roughness={0.55} />
    </mesh>
  );
}
