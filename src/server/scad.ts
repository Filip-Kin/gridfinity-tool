import { type BinConfig, type PlacedObject, type PlacedStl, type PlacedText } from "../shared/types";

const GRIDZ_DEFINE_MAP: Record<BinConfig["gridzMode"], number> = {
  increments: 0,
  internal: 1,
  external: 2,
  "external-with-lip": 3,
};

const STYLE_TAB_NONE = 5;

function num(n: number): string {
  return Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, "") : "0";
}

function escapeScadString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderStl(o: PlacedStl, stlPath: string): string {
  const [x, y, z] = o.position;
  const [ax, ay, az] = o.anchorOffset ?? [0, 0, 0];
  const oversize = 1 + o.oversizePct / 100;
  const unitScale = o.unitScale ?? 1;
  const rx = o.rotationX ?? 0;
  const ry = o.rotationY ?? 0;
  const rz = o.rotationZ;
  const [bpx, bpy, bpz] = o.bakedPostOffset ?? [0, 0, 0];
  const [brx, bry, brz] = o.bakedRotation ?? [0, 0, 0];
  // Reads inside-out:
  //   1. import raw STL
  //   2. scale unitScale (file units -> mm)
  //   3. translate originalAnchor (centers raw mesh: XY=0, Z bottom=0)
  //   4. rotate bakedRotation (frozen orientation from "Bake as new bottom")
  //   5. translate bakedPostOffset (re-centers the rotated bbox)
  //   6. scale oversize
  //   7. rotate user rotation (live X/Y/Z gizmo)
  //   8. translate to world position
  return [
    `// stl: ${o.filename}`,
    `translate([${num(x)}, ${num(y)}, ${num(z)}])`,
    `rotate([${num(rx)}, ${num(ry)}, ${num(rz)}])`,
    `scale([${num(oversize)}, ${num(oversize)}, ${num(oversize)}])`,
    `translate([${num(bpx)}, ${num(bpy)}, ${num(bpz)}])`,
    `rotate([${num(brx)}, ${num(bry)}, ${num(brz)}])`,
    `translate([${num(ax)}, ${num(ay)}, ${num(az)}])`,
    `scale([${num(unitScale)}, ${num(unitScale)}, ${num(unitScale)}])`,
    `import("${escapeScadString(stlPath)}", convexity = 10);`,
  ].join("\n  ");
}

// Compute the world Z of the lowest point of the STL's bounding box after
// applying oversize + X/Y rotation. Used to anchor the label to the actual
// cavity floor (in world coords), so tipping a tool on its side still puts
// the engraving on the bin floor instead of on the new "side" of the cavity.
function rotatedBboxMinLocalZ(o: PlacedStl): number {
  if (!o.bboxSize) return 0;
  const [w, d, h] = o.bboxSize;
  const s = 1 + o.oversizePct / 100;
  const sw = (w * s) / 2;
  const sd = (d * s) / 2;
  const sh = h * s;
  // Normalized local bbox after anchor centering + oversize: extents centered
  // in XY, going from z=0 up to z=sh.
  const corners: Array<[number, number, number]> = [
    [-sw, -sd, 0], [sw, -sd, 0], [-sw, sd, 0], [sw, sd, 0],
    [-sw, -sd, sh], [sw, -sd, sh], [-sw, sd, sh], [sw, sd, sh],
  ];
  const rx = ((o.rotationX ?? 0) * Math.PI) / 180;
  const ry = ((o.rotationY ?? 0) * Math.PI) / 180;
  // Z rotation doesn't change Z values, so we skip it.
  let minZ = Infinity;
  for (const [cx, cy, cz] of corners) {
    // X rotation (around X axis): y/z change
    const y1 = cy * Math.cos(rx) - cz * Math.sin(rx);
    const z1 = cy * Math.sin(rx) + cz * Math.cos(rx);
    // Y rotation (around Y axis): x/z change
    const z2 = -cx * Math.sin(ry) + z1 * Math.cos(ry);
    if (z2 < minZ) minZ = z2;
  }
  return minZ;
}

// Debossed text engraved on the cavity floor in world coords. Follows the
// tool's Z rotation (yaw) so multi-line labels stay aligned with the row,
// but ignores X/Y rotation so the label always sits on the world floor (not
// on whatever side the tool ended up pointing after a tip).
function renderStlLabel(o: PlacedStl): string {
  const raw = o.label;
  if (!raw) return "";
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  const size = o.labelSize ?? 6;
  const depth = o.labelDepth ?? 0.6;
  const lineHeight = size * 1.25;
  const font = "Liberation Sans:style=Bold";
  const ox = o.labelOffsetX ?? 0;
  const oy = o.labelOffsetY ?? 0;
  const [px, py, pz] = o.position;
  const rz = o.rotationZ + (o.labelRotation ?? 0);
  // World Z of the tool's bottom after rotation.
  const worldBottomZ = pz + rotatedBboxMinLocalZ(o);
  const labelZ = worldBottomZ - depth + 0.05;
  const blocks = lines.map((line, i) => {
    const yOffset = (lines.length - 1) / 2 - i;
    return [
      `// label for ${o.filename}: ${line.slice(0, 32)}`,
      `translate([${num(px + ox)}, ${num(py + oy)}, ${num(labelZ)}])`,
      `rotate([0, 0, ${num(rz)}])`,
      `translate([0, ${num(yOffset * lineHeight)}, 0])`,
      `linear_extrude(height = ${num(depth + 0.1)}, center = false)`,
      `text("${escapeScadString(line)}", size = ${num(size)}, font = "${escapeScadString(font)}", halign = "center", valign = "center", $fn = 32);`,
    ].join("\n  ");
  });
  return blocks.join("\n  ");
}

function renderText(o: PlacedText): string {
  const [x, y, z] = o.position;
  const font = o.font ?? "Liberation Sans:style=Bold";
  return [
    `// text: ${o.text.slice(0, 40)}`,
    `translate([${num(x)}, ${num(y)}, ${num(z)}])`,
    `rotate([0, 0, ${num(o.rotationZ)}])`,
    `linear_extrude(height = ${num(Math.max(0.01, o.depth))}, center = false)`,
    `text("${escapeScadString(o.text)}", size = ${num(o.size)}, font = "${escapeScadString(font)}", halign = "center", valign = "center", $fn = 32);`,
  ].join("\n  ");
}

export interface ScadBuildArgs {
  bin: BinConfig;
  objects: PlacedObject[];
  stlPathFor: (filename: string) => string;
  libraryPath: string;
}

export function buildScad({ bin, objects, stlPathFor, libraryPath }: ScadBuildArgs): string {
  const includes = [
    `include <${libraryPath}/src/core/standard.scad>`,
    `use <${libraryPath}/src/core/gridfinity-rebuilt-utility.scad>`,
    `use <${libraryPath}/src/core/gridfinity-rebuilt-holes.scad>`,
    `use <${libraryPath}/src/core/bin.scad>`,
    `use <${libraryPath}/src/core/cutouts.scad>`,
    `use <${libraryPath}/src/helpers/generic-helpers.scad>`,
    `use <${libraryPath}/src/helpers/grid.scad>`,
    `use <${libraryPath}/src/helpers/grid_element.scad>`,
  ].join("\n");

  const gridzDefine = GRIDZ_DEFINE_MAP[bin.gridzMode];
  // Library uses SINGULAR names: refined_hole / magnet_hole / screw_hole /
  // chamfer / supportless. Plural names silently fall back to defaults
  // (all false → no holes). refined_hole is NOT compatible with magnet_hole.
  const holeOpts = `bundle_hole_options(refined_hole=${!bin.magnetHoles && !bin.screwHoles}, magnet_hole=${bin.magnetHoles}, screw_hole=${bin.screwHoles}, crush_ribs=true, chamfer=true, supportless=true)`;

  const visibleObjects = objects.filter((o) => o.kind !== "stl" || !(o as PlacedStl).hidden);
  const embossText = visibleObjects.filter((o): o is PlacedText => o.kind === "text" && o.mode === "emboss");
  const cavityObjects = visibleObjects.filter((o) => o.kind === "stl" || (o.kind === "text" && o.mode === "deboss"));

  const cavityParts: string[] = [];
  for (const o of cavityObjects) {
    if (o.kind === "stl") {
      cavityParts.push(renderStl(o, stlPathFor(o.filename)));
      const labelBlock = renderStlLabel(o);
      if (labelBlock) cavityParts.push(labelBlock);
    } else {
      cavityParts.push(renderText(o));
    }
  }
  const cavityBody = cavityParts.join("\n  ");

  const embossBody = embossText.map((t) => renderText(t)).join("\n  ");

  const subdivisionBlock =
    bin.divx > 0 && bin.divy > 0
      ? `bin_subdivide(bin_obj, [${bin.divx}, ${bin.divy}]) {
    cut_compartment_auto(cgs(), ${bin.styleTab}, false, ${num(bin.scoop)});
  }`
      : "";

  // Two structural quirks of the gridfinity-rebuilt-openscad library handled here:
  //
  // 1. new_bin() renders the bin CENTERED at the origin (e.g. a 2-unit bin
  //    spans (-42,-42) to (42,42)). Our client preview draws the bin with its
  //    lower-left corner at the origin (0,0) to (gx*42, gy*42), and STL/text
  //    placements use that frame. So we shift the bin by [gx*21, gy*21] so
  //    its lower-left lands at world (0,0,0).
  //
  // 2. bin_render() auto-translates its children up by BASE_HEIGHT for the
  //    library's own compartment cutters. Our world-coord cavities can't go
  //    through that path; they're subtracted in an outer difference() instead.
  const binShiftX = num(bin.gridx * 21);
  const binShiftY = num(bin.gridy * 21);
  return `// Auto-generated by gridfinity-tool
$fa = 4;
$fs = 0.25;

${includes}

bin_obj = new_bin(
  grid_size = [${bin.gridx}, ${bin.gridy}],
  height_mm = height(${bin.gridz}, ${gridzDefine}, false),
  fill_height = 0,
  include_lip = ${bin.includeLip},
  hole_options = ${holeOpts},
  only_corners = ${bin.onlyCorners},
  thumbscrew = false
);

union() {
  difference() {
    translate([${binShiftX}, ${binShiftY}, 0])
    bin_render(bin_obj) {
      ${subdivisionBlock}
    }
    ${cavityBody || "// no custom cavities"}
  }
  ${embossBody ? `// Embossed text (added on top of bin)\n  ${embossBody}` : "// no embossed text"}
}
`;
}
