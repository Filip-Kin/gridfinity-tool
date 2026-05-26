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
  // Bounding box AFTER re-centering. Used for fit-to-bin sizing and previews.
  // Min should be (-w/2, -d/2, 0); max should be (w/2, d/2, h).
  bbox: THREE.Box3;
  anchorOffset: Vec3;
  sizeBytes: number;
}

type Status = "idle" | "uploading" | "rendering" | "error";
export type GizmoMode = "translate" | "rotate";

interface ParsedStl {
  geometry: THREE.BufferGeometry;
  bbox: THREE.Box3;
  anchorOffset: Vec3;
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
  renderBin: () => Promise<void>;
  downloadStl: () => void;
  clearError: () => void;
}

const loader = new STLLoader();
const BASE_HEIGHT_MM = 4.75;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Parse + normalize an STL so the local origin sits at (XY bbox center, Z bottom).
// Returns the anchorOffset (the translation we applied) so the same offset can be
// re-applied server-side when emitting the SCAD `import()` block. That keeps the
// preview and the rendered cavity perfectly aligned.
async function parseStl(buf: ArrayBuffer): Promise<ParsedStl> {
  const g = loader.parse(buf);
  g.computeBoundingBox();
  const orig = g.boundingBox ?? new THREE.Box3();
  const cx = (orig.min.x + orig.max.x) / 2;
  const cy = (orig.min.y + orig.max.y) / 2;
  const zMin = orig.min.z;
  g.translate(-cx, -cy, -zMin);
  g.computeBoundingBox();
  g.computeVertexNormals();
  return {
    geometry: g,
    bbox: (g.boundingBox ?? new THREE.Box3()).clone(),
    anchorOffset: [-cx, -cy, -zMin],
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
          sizeBytes: entry.sizeBytes,
        });
      }

      // Only auto-fit the bin and lay out fresh if this is the first content.
      const firstUpload = get().objects.length === 0;
      set({ uploads, status: "idle" });
      data.files.forEach((entry, i) => {
        get().addStlPlacement(entry.filename, firstUpload ? i : undefined);
      });
      if (firstUpload) get().fitBinToObjects();
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
    let maxX = 0,
      maxY = 0,
      maxZ = 0;
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
    const footprintX = Math.max(0, maxX - Math.max(0, minX));
    const footprintY = Math.max(0, maxY - Math.max(0, minY));
    // Wall margin: gridfinity inner wall takes ~3.5mm per side, plus a couple mm of clearance.
    const margin = 6;
    const gridx = Math.max(1, Math.ceil((footprintX + margin) / 42));
    const gridy = Math.max(1, Math.ceil((footprintY + margin) / 42));
    const gridz = Math.max(2, Math.ceil((maxZ - BASE_HEIGHT_MM + 3) / 7));
    set((s) => ({
      bin: { ...bin, gridx, gridy, gridz, gridzMode: "increments" },
      ...invalidateRender(s.lastStlBlobUrl),
    }));
    get().centerAllXY();
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
