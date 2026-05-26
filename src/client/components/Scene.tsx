import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Suspense } from "react";
import { useStore } from "../lib/store";
import { BinPreview } from "./BinPreview";
import { PlacedObjects } from "./PlacedObjects";

export function Scene() {
  const bin = useStore((s) => s.bin);
  const selectObject = useStore((s) => s.selectObject);
  const cameraDist = Math.max(bin.gridx, bin.gridy) * 42 * 1.8 + 80;
  return (
    <Canvas
      shadows
      camera={{ position: [cameraDist, -cameraDist, cameraDist * 0.7], fov: 35, up: [0, 0, 1], near: 1, far: 4000 }}
      onPointerMissed={() => selectObject(null)}
    >
      <color attach="background" args={["#13151b"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[200, 200, 400]} intensity={0.9} castShadow />
      <directionalLight position={[-200, -200, 200]} intensity={0.3} />
      <Grid
        position={[0, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        args={[1000, 1000]}
        cellSize={42}
        cellThickness={1}
        sectionSize={42 * 4}
        sectionThickness={1.5}
        cellColor="#2a313d"
        sectionColor="#3e4a5e"
        fadeDistance={800}
        infiniteGrid
      />
      <Suspense fallback={null}>
        <BinPreview bin={bin} />
        <PlacedObjects />
      </Suspense>
      <OrbitControls
        target={[bin.gridx * 21, bin.gridy * 21, bin.gridz * 3.5]}
        makeDefault
        enableDamping
        dampingFactor={0.1}
      />
    </Canvas>
  );
}
