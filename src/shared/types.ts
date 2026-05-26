export const GRID_UNIT_MM = 42;
export const UNIT_HEIGHT_MM = 7;
export const LIP_HEIGHT_MM = 3.55147;
export const BASE_HEIGHT_MM = 4.75;

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
  oversizePct: number;
  // Applied as innermost translate inside the SCAD import block so the STL's
  // "anchor" (XY center, Z bottom of the *scaled* mesh) lands at `position`.
  // Computed at upload time from the parsed mesh bounding box after unitScale is applied.
  anchorOffset: Vec3;
  // Multiplier from the STL file's native units to mm. 1 = already in mm,
  // 1000 = meters (Onshape's "Units: Meter" export), 25.4 = inches.
  // Applied as the innermost scale() in the SCAD import block.
  unitScale: number;
  // Optional debossed label cut into the cavity floor under this STL.
  // Multi-line: newlines split into stacked lines, all centered on the STL's XY.
  label?: string;
  labelSize?: number;  // mm, default 4
  labelDepth?: number; // mm, default 0.6
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
