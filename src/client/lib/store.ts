import { create } from "zustand";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  DEFAULT_BIN,
  type PlacedObject,
  type PlacedStl,
  type PlacedText,
  type RenderRequest,
  type UploadResponse,
  type Vec3,
  type BinConfig,
} from "@shared/types";

export interface UploadCache {
  filename: string;
  originalName: string;
  geometry: THREE.BufferGeometry;
  // Bounding box AFTER unit normalization + re-centering. Always in mm.
  // Min should be (-w/2, -d/2, 0); max should be (w/2, d/2, h).
  bbox: THREE.Box3;
  anchorOffset: Vec3;
  unitScale: number;
  detectedUnit: "mm" | "m";
  sizeBytes: number;
}

type Status = "idle" | "uploading" | "rendering" | "error";
export type GizmoMode = "translate" | "rotate";

interface ParsedStl {
  geometry: THREE.BufferGeometry;
  bbox: THREE.Box3;
  anchorOffset: Vec3;
  unitScale: number;
  detectedUnit: "mm" | "m";
}

interface AppState {
  sessionId: string | null;
  bin: BinConfig;
  objects: PlacedObject[];
  uploads: Map<string, UploadCache>;
  selectedId: string | null;
  gizmoMode: GizmoMode;
  status: Status;
  lastError: string | null;
  lastStlBlobUrl: string | null;
  lastRenderMs: number | null;
  stale: boolean;

  setBin: (patch: Partial<BinConfig>) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  ensureSession: () => Promise<string>;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  addStlPlacement: (filename: string, indexInBatch?: number) => void;
  addText: () => void;
  updateObject: (id: string, patch: Partial<PlacedObject>) => void;
  removeObject: (id: string) => void;
  selectObject: (id: string | null) => void;
  centerSelectedXY: () => void;
  centerAllXY: () => void;
  dropSelectedToFloor: () => void;
  fitBinToObjects: () => void;
  autoArrange: () => void;
  renderBin: () => Promise<void>;
  downloadStl: () => void;
  clearError: () => void;
}

const loader = new STLLoader();
const BASE_HEIGHT_MM = 4.75;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Parse + normalize an STL.
// 1. STLs have no unit metadata, so we sniff: max bbox dim < 1 ⇒ file is in meters
//    (Onshape's "Units: Meter" export). Scale by 1000 to bring into mm.
// 2. Translate so local origin sits at (XY bbox center, Z bottom) of the *scaled* mesh.
// Both the unit scale and the translate are passed to the server so the SCAD
// import block reapplies them in the same order, keeping preview ≡ render.
async function parseStl(buf: ArrayBuffer): Promise<ParsedStl> {
  const g = loader.parse(buf);
  g.computeBoundingBox();
  const raw = g.boundingBox ?? new THREE.Box3();
  const rawSize = new THREE.Vector3();
  raw.getSize(rawSize);
  const rawMax = Math.max(rawSize.x, rawSize.y, rawSize.z);

  let unitScale = 1;
  let detectedUnit: "mm" | "m" = "mm";
  if (rawMax > 0 && rawMax < 1) {
    unitScale = 1000;
    detectedUnit = "m";
    console.log(
      `[gridfinity] STL appears to be in meters (max dim ${rawMax.toFixed(4)}); scaling by 1000`,
    );
    g.scale(unitScale, unitScale, unitScale);
    g.computeBoundingBox();
  }

  const bbox = g.boundingBox ?? new THREE.Box3();
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cy = (bbox.min.y + bbox.max.y) / 2;
  const zMin = bbox.min.z;
  g.translate(-cx, -cy, -zMin);
  g.computeBoundingBox();
  g.computeVertexNormals();
  return {
    geometry: g,
    bbox: (g.boundingBox ?? new THREE.Box3()).clone(),
    anchorOffset: [-cx, -cy, -zMin],
    unitScale,
    detectedUnit,
  };
}

function bbSize(b: THREE.Box3): THREE.Vector3 {
  const v = new THREE.Vector3();
  b.getSize(v);
  return v;
}

// Marks any cached render as stale. Call after any state change that affects the SCAD output.
function invalidateRender(prev: string | null): { lastStlBlobUrl: null; lastRenderMs: null; stale: true } {
  if (prev) URL.revokeObjectURL(prev);
  return { lastStlBlobUrl: null, lastRenderMs: null, stale: true };
}

export const useStore = create<AppState>((set, get) => ({
  sessionId: null,
  bin: { ...DEFAULT_BIN },
  objects: [],
  uploads: new Map(),
  selectedId: null,
  gizmoMode: "translate",
  status: "idle",
  lastError: null,
  lastStlBlobUrl: null,
  lastRenderMs: null,
  stale: true,

  setBin: (patch) =>
    set((s) => ({ bin: { ...s.bin, ...patch }, ...invalidateRender(s.lastStlBlobUrl) })),

  setGizmoMode: (mode) => set({ gizmoMode: mode }),

  ensureSession: async () => {
    const existing = get().sessionId;
    if (existing) return existing;
    const res = await fetch("/api/session", { method: "POST" });
    if (!res.ok) throw new Error("failed to create session");
    const data = (await res.json()) as { sessionId: string };
    set({ sessionId: data.sessionId });
    return data.sessionId;
  },

  uploadFiles: async (files) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    set({ status: "uploading", lastError: null });
    try {
      const sessionId = await get().ensureSession();
      const form = new FormData();
      form.append("sessionId", sessionId);
      for (const f of list) form.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? "upload failed");
      }
      const data = (await res.json()) as UploadResponse;
      const uploads = new Map(get().uploads);
      for (const entry of data.files) {
        const src = list.find((f) => f.name === entry.originalName);
        if (!src) continue;
        const buf = await src.arrayBuffer();
        const parsed = await parseStl(buf);
        uploads.set(entry.filename, {
          filename: entry.filename,
          originalName: entry.originalName,
          geometry: parsed.geometry,
          bbox: parsed.bbox,
          anchorOffset: parsed.anchorOffset,
          unitScale: parsed.unitScale,
          detectedUnit: parsed.detectedUnit,
          sizeBytes: entry.sizeBytes,
        });
      }

      // Only auto-arrange + fit on first content. Subsequent uploads
      // append at the bin center (the user can hit "Auto arrange" to reflow).
      const firstUpload = get().objects.length === 0;
      set({ uploads, status: "idle" });
      data.files.forEach((entry, i) => {
        get().addStlPlacement(entry.filename, firstUpload ? i : undefined);
      });
      if (firstUpload) get().autoArrange();
    } catch (err) {
      set({ status: "error", lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  addStlPlacement: (filename, indexInBatch) => {
    const upload = get().uploads.get(filename);
    if (!upload) return;
    const bin = get().bin;
    // Default placement: centered XY on the bin, anchor (Z bottom) on the cavity floor.
    // For multi-file batches, spread along X using the bbox width so they don't overlap.
    let cx = (bin.gridx * 42) / 2;
    const cy = (bin.gridy * 42) / 2;
    if (indexInBatch !== undefined && indexInBatch > 0) {
      const size = bbSize(upload.bbox);
      cx += indexInBatch * (size.x + 4);
    }
    const obj: PlacedStl = {
      id: uid(),
      kind: "stl",
      filename,
      position: [cx, cy, BASE_HEIGHT_MM],
      rotationZ: 0,
      oversizePct: 2,
      anchorOffset: upload.anchorOffset,
      unitScale: upload.unitScale,
    };
    set((s) => ({
      objects: [...s.objects, obj],
      selectedId: obj.id,
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  addText: () => {
    const bin = get().bin;
    const obj: PlacedText = {
      id: uid(),
      kind: "text",
      text: "LABEL",
      position: [(bin.gridx * 42) / 2, (bin.gridy * 42) / 2, BASE_HEIGHT_MM + 0.5],
      rotationZ: 0,
      size: 6,
      depth: 0.8,
      mode: "deboss",
    };
    set((s) => ({
      objects: [...s.objects, obj],
      selectedId: obj.id,
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  updateObject: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as PlacedObject) : o)),
      ...invalidateRender(s.lastStlBlobUrl),
    })),

  removeObject: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      ...invalidateRender(s.lastStlBlobUrl),
    })),

  selectObject: (id) => set({ selectedId: id }),

  centerSelectedXY: () => {
    const { selectedId, bin } = get();
    if (!selectedId) return;
    const cx = (bin.gridx * 42) / 2;
    const cy = (bin.gridy * 42) / 2;
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === selectedId ? { ...o, position: [cx, cy, o.position[2]] as Vec3 } : o,
      ),
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  centerAllXY: () => {
    const bin = get().bin;
    const cx = (bin.gridx * 42) / 2;
    const cy = (bin.gridy * 42) / 2;
    set((s) => ({
      objects: s.objects.map((o) => ({ ...o, position: [cx, cy, o.position[2]] as Vec3 })),
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  dropSelectedToFloor: () => {
    const { selectedId } = get();
    if (!selectedId) return;
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== selectedId) return o;
        const z = o.kind === "stl" ? BASE_HEIGHT_MM : BASE_HEIGHT_MM + 0.5;
        return { ...o, position: [o.position[0], o.position[1], z] as Vec3 };
      }),
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  fitBinToObjects: () => {
    const { objects, uploads, bin } = get();
    if (objects.length === 0) return;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = BASE_HEIGHT_MM;
    let minX = Infinity,
      minY = Infinity;
    for (const o of objects) {
      const scale = o.kind === "stl" ? 1 + (o as PlacedStl).oversizePct / 100 : 1;
      let w = 0,
        d = 0,
        h = 0;
      if (o.kind === "stl") {
        const up = uploads.get(o.filename);
        if (!up) continue;
        const s = bbSize(up.bbox);
        w = s.x * scale;
        d = s.y * scale;
        h = s.z * scale;
      } else {
        w = Math.max(2, o.text.length * o.size * 0.55);
        d = o.size;
        h = o.depth;
      }
      const halfW = w / 2,
        halfD = d / 2;
      minX = Math.min(minX, o.position[0] - halfW);
      minY = Math.min(minY, o.position[1] - halfD);
      maxX = Math.max(maxX, o.position[0] + halfW);
      maxY = Math.max(maxY, o.position[1] + halfD);
      maxZ = Math.max(maxZ, o.position[2] + (o.kind === "stl" ? h : 0));
    }
    if (!Number.isFinite(minX)) return;
    const footprintX = maxX - minX;
    const footprintY = maxY - minY;
    // Gridfinity inner wall is ~3.5mm/side; add a couple mm of clearance.
    const margin = 6;
    const gridx = Math.max(1, Math.ceil((footprintX + margin) / 42));
    const gridy = Math.max(1, Math.ceil((footprintY + margin) / 42));
    const gridz = Math.max(2, Math.ceil((maxZ - BASE_HEIGHT_MM + 3) / 7));
    const binW = gridx * 42;
    const binD = gridy * 42;
    // Shift every object so the existing layout is centered in the new bin.
    // Preserves relative positions (so multi-STL layouts don't collapse).
    const shiftX = (binW - footprintX) / 2 - minX;
    const shiftY = (binD - footprintY) / 2 - minY;
    set((s) => ({
      bin: { ...bin, gridx, gridy, gridz, gridzMode: "increments" },
      objects: s.objects.map((o) => ({
        ...o,
        position: [o.position[0] + shiftX, o.position[1] + shiftY, o.position[2]] as Vec3,
      })),
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  autoArrange: () => {
    const { objects, uploads } = get();
    const stls = objects.filter((o): o is PlacedStl => o.kind === "stl");
    if (stls.length === 0) {
      if (objects.length > 0) get().fitBinToObjects();
      return;
    }
    interface Item {
      id: string;
      w: number;
      d: number;
      h: number;
    }
    const items: Item[] = stls.map((o) => {
      const up = uploads.get(o.filename);
      const scale = 1 + o.oversizePct / 100;
      const s = up ? bbSize(up.bbox) : new THREE.Vector3();
      return { id: o.id, w: s.x * scale, d: s.y * scale, h: s.z * scale };
    });
    const N = items.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
    const rows = Math.ceil(N / cols);
    const gap = 3;
    const cellW = Math.max(1, ...items.map((i) => i.w)) + gap;
    const cellD = Math.max(1, ...items.map((i) => i.d)) + gap;
    const maxH = Math.max(0, ...items.map((i) => i.h));
    const margin = 6;
    const gridx = Math.max(1, Math.ceil((cols * cellW - gap + margin) / 42));
    const gridy = Math.max(1, Math.ceil((rows * cellD - gap + margin) / 42));
    const gridz = Math.max(2, Math.ceil((maxH + 3) / 7));
    const binW = gridx * 42;
    const binD = gridy * 42;
    const usedW = cols * cellW - gap;
    const usedD = rows * cellD - gap;
    const startX = (binW - usedW) / 2 + cellW / 2 - gap / 2;
    const startY = (binD - usedD) / 2 + cellD / 2 - gap / 2;
    const newPos = new Map<string, Vec3>();
    items.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      newPos.set(item.id, [startX + col * cellW, startY + row * cellD, BASE_HEIGHT_MM]);
    });
    set((s) => ({
      bin: { ...s.bin, gridx, gridy, gridz, gridzMode: "increments" },
      objects: s.objects.map((o) => {
        const p = newPos.get(o.id);
        return p ? ({ ...o, position: p } as PlacedObject) : o;
      }),
      ...invalidateRender(s.lastStlBlobUrl),
    }));
  },

  renderBin: async () => {
    set({ status: "rendering", lastError: null });
    try {
      const sessionId = await get().ensureSession();
      const body: RenderRequest = {
        sessionId,
        bin: get().bin,
        objects: get().objects,
      };
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.stderr ?? err.error ?? "render failed");
      }
      const ms = parseInt(res.headers.get("X-Render-Duration-Ms") ?? "0", 10) || null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const prev = get().lastStlBlobUrl;
      if (prev) URL.revokeObjectURL(prev);
      set({ status: "idle", lastStlBlobUrl: url, lastRenderMs: ms, stale: false });
    } catch (err) {
      set({ status: "error", lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  downloadStl: () => {
    const url = get().lastStlBlobUrl;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "gridfinity-bin.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  clearError: () => set({ lastError: null, status: "idle" }),
}));
