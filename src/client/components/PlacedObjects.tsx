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
  const [bpx, bpy, bpz] = obj.bakedPostOffset ?? [0, 0, 0];
  const [brx, bry, brz] = obj.bakedRotation ?? [0, 0, 0];
  // Match the SCAD chain EXACTLY: scale(oversize) * translate(bakedPost) *
  // rotate(baked) * upload-geometry. Three.js combines T+R+S inside a single
  // group as T*R*S, so to get S*T separated we need them on SEPARATE groups
  // (otherwise bakedPost wouldn't be scaled by oversize and preview drifts
  // from render).
  return (
    <group scale={[scale, scale, scale]}>
      <group position={[bpx, bpy, bpz]}>
        <group rotation={[(brx * Math.PI) / 180, (bry * Math.PI) / 180, (brz * Math.PI) / 180]}>
          <mesh geometry={upload.geometry} castShadow>
            <meshStandardMaterial
              color={selected ? "#ffaa66" : "#ff8855"}
              transparent
              opacity={selected ? 0.75 : 0.55}
            />
          </mesh>
        </group>
      </group>
    </group>
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

// Mirror of scad.ts rotatedBboxMinLocalZ — returns the min Z of the STL's
// scaled bounding box (post-bake) after applying the live user X/Y rotation.
// bakedRotation is already absorbed into bboxSize, so we only rotate by the
// user's current X/Y here.
function rotatedBboxMinLocalZ(obj: PlacedStl): number {
  const size = obj.bboxSize;
  if (!size) return 0;
  const [w, d, h] = size;
  const s = 1 + obj.oversizePct / 100;
  const sw = (w * s) / 2;
  const sd = (d * s) / 2;
  const sh = h * s;
  const corners: Array<[number, number, number]> = [
    [-sw, -sd, 0], [sw, -sd, 0], [-sw, sd, 0], [sw, sd, 0],
    [-sw, -sd, sh], [sw, -sd, sh], [-sw, sd, sh], [sw, sd, sh],
  ];
  const rx = ((obj.rotationX ?? 0) * Math.PI) / 180;
  const ry = ((obj.rotationY ?? 0) * Math.PI) / 180;
  let minZ = Infinity;
  for (const [cx, cy, cz] of corners) {
    const y1 = cy * Math.cos(rx) - cz * Math.sin(rx);
    const z1 = cy * Math.sin(rx) + cz * Math.cos(rx);
    const z2 = -cx * Math.sin(ry) + z1 * Math.cos(ry);
    if (z2 < minZ) minZ = z2;
  }
  return minZ;
}

// Label preview. Lives OUTSIDE the Draggable's rotated group: the label
// inherits only the tool's Z rotation (yaw) but ignores X/Y tip, so tipping
// a tool on its side still shows the label on the world cavity floor.
function StlLabelPreview({ obj }: { obj: PlacedStl }) {
  const raw = obj.label;
  if (!raw) return null;
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const size = obj.labelSize ?? 6;
  const depth = obj.labelDepth ?? 0.6;
  const lineHeight = size * 1.25;
  const ox = obj.labelOffsetX ?? 0;
  const oy = obj.labelOffsetY ?? 0;
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const plateW = longest * size * 0.65;
  const plateD = size * 1.1;
  const worldBottomZ = obj.position[2] + rotatedBboxMinLocalZ(obj);
  const labelZ = worldBottomZ - depth + 0.05;
  const groupPos: [number, number, number] = [obj.position[0] + ox, obj.position[1] + oy, labelZ];
  const labelZRot = obj.rotationZ + (obj.labelRotation ?? 0);
  const groupRot: [number, number, number] = [0, 0, (labelZRot * Math.PI) / 180];
  return (
    <group position={groupPos} rotation={groupRot} renderOrder={10}>
      {lines.map((line, i) => {
        const yOffset = (lines.length - 1) / 2 - i;
        return (
          <group key={`${i}-${line}`} position={[0, yOffset * lineHeight, 0]}>
            <mesh renderOrder={1000}>
              <boxGeometry args={[plateW, plateD, 0.05]} />
              <meshBasicMaterial color="#7d4cd9" transparent opacity={0.55} depthTest={false} />
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
      </group>
      {obj.kind === "stl" && <StlLabelPreview obj={obj} />}
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
