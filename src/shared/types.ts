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
  // "anchor" (XY center, Z bottom of the original mesh) lands at `position`.
  // Computed at upload time from the parsed mesh bounding box.
  anchorOffset: Vec3;
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
  gridz: 3,
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
