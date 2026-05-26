import { create } from "zustand";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  DEFAULT_BIN,
  type BinConfig,
  type PlacedObject,
  type PlacedStl,
  type PlacedText,
  type RenderRequest,
  type UploadResponse,
} from "@shared/types";

export interface UploadCache {
  filename: string;
  originalName: string;
  geometry: THREE.BufferGeometry;
  bbox: THREE.Box3;
  sizeBytes: number;
}

type Status = "idle" | "uploading" | "rendering" | "error";
export type GizmoMode = "translate" | "rotate";

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

  setBin: (patch: Partial<BinConfig>) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  ensureSession: () => Promise<string>;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  addStlPlacement: (filename: string) => void;
  addText: () => void;
  updateObject: (id: string, patch: Partial<PlacedObject>) => void;
  removeObject: (id: string) => void;
  selectObject: (id: string | null) => void;
  renderBin: () => Promise<void>;
  clearError: () => void;
}

const loader = new STLLoader();

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function parseStl(buf: ArrayBuffer): Promise<THREE.BufferGeometry> {
  const g = loader.parse(buf);
  g.computeBoundingBox();
  g.computeVertexNormals();
  return g;
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

  setBin: (patch) => set((s) => ({ bin: { ...s.bin, ...patch } })),
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
        const g = await parseStl(buf);
        const bbox = g.boundingBox ?? new THREE.Box3();
        uploads.set(entry.filename, {
          filename: entry.filename,
          originalName: entry.originalName,
          geometry: g,
          bbox,
          sizeBytes: entry.sizeBytes,
        });
      }
      set({ uploads, status: "idle" });
      for (const entry of data.files) {
        get().addStlPlacement(entry.filename);
      }
    } catch (err) {
      set({ status: "error", lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  addStlPlacement: (filename) => {
    const upload = get().uploads.get(filename);
    if (!upload) return;
    const bbox = upload.bbox;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const bin = get().bin;
    const cx = (bin.gridx * 42) / 2;
    const cy = (bin.gridy * 42) / 2;
    const cz = 6 + size.z / 2;
    const obj: PlacedStl = {
      id: uid(),
      kind: "stl",
      filename,
      position: [cx, cy, cz],
      rotationZ: 0,
      oversizePct: 2,
    };
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id }));
  },

  addText: () => {
    const bin = get().bin;
    // Default: debossed on cavity floor. Base height is ~6mm; text starts at floor.
    const obj: PlacedText = {
      id: uid(),
      kind: "text",
      text: "LABEL",
      position: [(bin.gridx * 42) / 2, (bin.gridy * 42) / 2, 5.5],
      rotationZ: 0,
      size: 6,
      depth: 0.8,
      mode: "deboss",
    };
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id }));
  },

  updateObject: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as PlacedObject) : o)),
    })),

  removeObject: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectObject: (id) => set({ selectedId: id }),

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
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const prev = get().lastStlBlobUrl;
      if (prev) URL.revokeObjectURL(prev);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gridfinity-bin.stl";
      document.body.appendChild(a);
      a.click();
      a.remove();
      set({ status: "idle", lastStlBlobUrl: url });
    } catch (err) {
      set({ status: "error", lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  clearError: () => set({ lastError: null, status: "idle" }),
}));
