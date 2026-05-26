import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Html, TransformControls } from "@react-three/drei";
import { useStore } from "../lib/store";
import type { PlacedObject, PlacedStl, PlacedText } from "@shared/types";

interface StlBodyProps {
  obj: PlacedStl;
}

function StlBody({ obj }: StlBodyProps) {
  const upload = useStore((s) => s.uploads.get(obj.filename));
  const selected = useStore((s) => s.selectedId === obj.id);
  if (!upload) return null;
  const scale = 1 + obj.oversizePct / 100;
  return (
    <mesh geometry={upload.geometry} scale={[scale, scale, scale]} castShadow>
      <meshStandardMaterial
        color={selected ? "#ffaa66" : "#ff8855"}
        transparent
        opacity={selected ? 0.75 : 0.55}
      />
    </mesh>
  );
}

interface TextBodyProps {
  obj: PlacedText;
}

function TextBody({ obj }: TextBodyProps) {
  const selected = useStore((s) => s.selectedId === obj.id);
  const w = Math.max(2, obj.text.length * obj.size * 0.55);
  const h = obj.size;
  const color = obj.mode === "deboss" ? "#9966ff" : "#66ff99";
  return (
    <mesh>
      <boxGeometry args={[w, h, Math.max(0.4, obj.depth)]} />
      <meshStandardMaterial color={color} transparent opacity={selected ? 0.8 : 0.55} />
    </mesh>
  );
}

// Label preview. Rendered INSIDE the Draggable's rotated group so it follows
// the STL's pose. Each line is a thin colored backplate (always visible 3D
// mesh, even if the HTML layer below fails) plus a drei <Html transform> so
// the actual text content shows up using the browser's fonts (no external
// font CDN required, unlike drei's <Text>).
function StlLabelPreview({ obj }: { obj: PlacedStl }) {
  const raw = obj.label;
  if (!raw) return null;
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const size = obj.labelSize ?? 6;
  const lineHeight = size * 1.25;
  const ox = obj.labelOffsetX ?? 0;
  const oy = obj.labelOffsetY ?? 0;
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const plateW = longest * size * 0.65;
  const plateD = size * 1.1;
  return (
    <group renderOrder={10}>
      {lines.map((line, i) => {
        const yOffset = (lines.length - 1) / 2 - i;
        const ly = oy + yOffset * lineHeight;
        return (
          <group key={`${i}-${line}`} position={[ox, ly, -0.1]}>
            <mesh renderOrder={1000}>
              <boxGeometry args={[plateW, plateD, 0.05]} />
              <meshBasicMaterial color="#7d4cd9" transparent opacity={0.45} depthTest={false} />
            </mesh>
            <Html
              transform
              center
              occlude={false}
              distanceFactor={10}
              zIndexRange={[10000, 0]}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              <div
                style={{
                  color: "#fff",
                  fontWeight: 700,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontSize: `${size * 6}px`,
                  letterSpacing: "0.04em",
                  textShadow: "0 0 4px #000, 0 0 2px #000",
                  whiteSpace: "nowrap",
                  lineHeight: 1,
                }}
              >
                {line}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

interface DraggableProps {
  obj: PlacedObject;
}

function Draggable({ obj }: DraggableProps) {
  const updateObject = useStore((s) => s.updateObject);
  const selectObject = useStore((s) => s.selectObject);
  const selected = useStore((s) => s.selectedId === obj.id);
  const mode = useStore((s) => s.gizmoMode);

  const groupRef = useRef<THREE.Group>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (groupRef.current) setReady(true);
  }, []);

  const onChange = () => {
    const g = groupRef.current;
    if (!g) return;
    const patch: Partial<PlacedObject> =
      obj.kind === "stl"
        ? {
            position: [g.position.x, g.position.y, g.position.z],
            rotationX: (g.rotation.x * 180) / Math.PI,
            rotationY: (g.rotation.y * 180) / Math.PI,
            rotationZ: (g.rotation.z * 180) / Math.PI,
          }
        : {
            position: [g.position.x, g.position.y, g.position.z],
            rotationZ: (g.rotation.z * 180) / Math.PI,
          };
    updateObject(obj.id, patch);
  };

  const rx = obj.kind === "stl" ? ((obj as PlacedStl).rotationX ?? 0) : 0;
  const ry = obj.kind === "stl" ? ((obj as PlacedStl).rotationY ?? 0) : 0;
  return (
    <>
      <group
        ref={groupRef}
        position={obj.position}
        rotation={[(rx * Math.PI) / 180, (ry * Math.PI) / 180, (obj.rotationZ * Math.PI) / 180]}
        onPointerDown={(e) => {
          e.stopPropagation();
          selectObject(obj.id);
        }}
      >
        {obj.kind === "stl" ? <StlBody obj={obj} /> : <TextBody obj={obj} />}
        {obj.kind === "stl" && <StlLabelPreview obj={obj} />}
      </group>
      {selected && ready && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode={mode}
          showZ={true}
          showX={true}
          showY={true}
          rotationSnap={mode === "rotate" ? Math.PI / 12 : undefined}
          translationSnap={mode === "translate" ? 0.5 : undefined}
          size={0.8}
          onObjectChange={onChange}
        />
      )}
    </>
  );
}

export function PlacedObjects() {
  const objects = useStore((s) => s.objects);
  return (
    <>
      {objects.map((o) => (
        <Draggable key={o.id} obj={o} />
      ))}
    </>
  );
}
