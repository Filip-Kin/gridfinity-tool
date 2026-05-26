export const GRID_UNIT_MM = 42;
export const UNIT_HEIGHT_MM = 7;
export const LIP_HEIGHT_MM = 3.55147;
// Z of the cavity floor. Matches BASE_HEIGHT in gridfinity-rebuilt-openscad's
// standard.scad. Anything below this is gridfinity base structure (stepped
// squares, magnet/screw holes); cavities + labels reference this as "floor".
export const BASE_HEIGHT_MM = 7;

export type Vec3 = [number, number, number];

export type GridzMode = "increments" | "internal" | "external" | "external-with-lip";

export interface BinConfig {
  gridx: number;
  gridy: number;
  gridz: number;
  gridzMode: GridzMode;
  includeLip: boolean;
  divx: number;
  divy: number;
  magnetHoles: boolean;
  screwHoles: boolean;
  onlyCorners: boolean;
  scoop: number;
  styleTab: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface PlacedStl {
  id: string;
  kind: "stl";
  filename: string;
  position: Vec3;
  rotationZ: number;
  rotationY?: number; // tip the tool forward/back (around Y axis), degrees
  rotationX?: number; // roll the tool around its long axis (around X), degrees
  oversizePct: number;
  // Applied as innermost translate inside the SCAD import block so the STL's
  // "anchor" (XY center, Z bottom of the *scaled* mesh) lands at `position`.
  // Computed at upload time from the parsed mesh bounding box after unitScale is applied.
  anchorOffset: Vec3;
  // Multiplier from the STL file's native units to mm. 1 = already in mm,
  // 1000 = meters (Onshape's "Units: Meter" export), 25.4 = inches.
  // Applied as the innermost scale() in the SCAD import block.
  unitScale: number;
  // Bounding box dimensions [w, d, h] in mm (post unit-scale + anchor centering
  // AND post baked-rotation re-centering, if any). Used for layout, label
  // positioning, and exposure math.
  bboxSize?: Vec3;
  // Optional "bake" of an orientation as the new bottom face of the tool.
  // Captures rotationX/Y/Z as a frozen baseline applied BEFORE the user's
  // per-placement rotation in the SCAD transform chain. After baking,
  // rotationX/Y/Z are reset to 0, so Auto arrange / Center group / labels
  // all use the correct oriented bbox.
  bakedRotation?: Vec3;
  // Re-center translate applied between the baked rotation and the live
  // user rotation, so the rotated geometry's local origin lands at
  // (XY center, Z bottom) of the new (post-bake) bbox.
  bakedPostOffset?: Vec3;
  // Optional debossed label cut into the floor of this STL's cavity.
  // Multi-line: newlines split into stacked lines, all centered on the STL's
  // XY (plus optional offset). Z auto-tracks the STL's position so it always
  // engraves just under the bottom of the cavity, not the container floor.
  label?: string;
  labelSize?: number;    // mm, default 6
  labelDepth?: number;   // mm, default 0.6
  labelOffsetX?: number; // mm, default 0 — shift label left/right of STL center
  labelOffsetY?: number; // mm, default 0 — shift label fore/aft of STL center
  labelRotation?: number; // degrees, default 0 — rotation around Z, on top of tool's Z rotation
  hidden?: boolean;
}

export interface PlacedText {
  id: string;
  kind: "text";
  text: string;
  position: Vec3;
  rotationZ: number;
  size: number;
  depth: number;
  mode: "deboss" | "emboss";
  font?: string;
}

export type PlacedObject = PlacedStl | PlacedText;

export interface RenderRequest {
  sessionId: string;
  bin: BinConfig;
  objects: PlacedObject[];
}

export interface UploadResponse {
  sessionId: string;
  files: Array<{
    filename: string;
    originalName: string;
    sizeBytes: number;
  }>;
}

export const DEFAULT_BIN: BinConfig = {
  gridx: 2,
  gridy: 2,
  gridz: 4,
  gridzMode: "increments",
  includeLip: true,
  divx: 0,
  divy: 0,
  magnetHoles: false,
  screwHoles: false,
  onlyCorners: false,
  scoop: 0,
  styleTab: 5,
};
