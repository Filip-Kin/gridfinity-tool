import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Text, TransformControls } from "@react-three/drei";
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
  // Match SCAD: label is axis-aligned in world coords (not under STL rotation).
  const x = obj.position[0] + ox;
  const y = obj.position[1] + oy;
  // Just under the STL bottom so it looks like it'll sit on the cavity floor.
  const z = obj.position[2] - 0.1;
  return (
    <group renderOrder={10}>
      {lines.map((line, i) => {
        const yOffset = (lines.length - 1) / 2 - i;
        return (
          <Text
            key={`${i}-${line}`}
            position={[x, y + yOffset * lineHeight, z]}
            fontSize={size}
            color="#cf9fff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.05}
            outlineColor="#3a1c5a"
          >
            {line}
          </Text>
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
