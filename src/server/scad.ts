import { BASE_HEIGHT_MM, type BinConfig, type PlacedObject, type PlacedStl, type PlacedText } from "../shared/types";

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
  // Reads inside-out: import raw STL → scale to mm → translate by mm anchor →
  // oversize → rotate → final world position. Matches the client preview.
  return [
    `// stl: ${o.filename}`,
    `translate([${num(x)}, ${num(y)}, ${num(z)}])`,
    `rotate([0, 0, ${num(o.rotationZ)}])`,
    `scale([${num(oversize)}, ${num(oversize)}, ${num(oversize)}])`,
    `translate([${num(ax)}, ${num(ay)}, ${num(az)}])`,
    `scale([${num(unitScale)}, ${num(unitScale)}, ${num(unitScale)}])`,
    `import("${escapeScadString(stlPath)}", convexity = 10);`,
  ].join("\n  ");
}

// Debossed text on the cavity floor under an STL. Cuts into the base from
// just-below the floor (z = BASE_HEIGHT - depth + overlap) upward through the
// floor plane, so when the tool is removed you see engraved text on the floor.
function renderStlLabel(o: PlacedStl): string {
  const raw = o.label;
  if (!raw) return "";
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  const size = o.labelSize ?? 8;
  const depth = o.labelDepth ?? 0.6;
  const lineHeight = size * 1.25;
  const font = "Liberation Sans:style=Bold";
  const [x, y] = o.position;
  // Top of label geometry sits slightly above the floor so the boolean cut is clean.
  const z = BASE_HEIGHT_MM - depth + 0.05;
  const blocks = lines.map((line, i) => {
    const yOffset = (lines.length - 1) / 2 - i;
    const ly = y + yOffset * lineHeight;
    return [
      `// label for ${o.filename}: ${line.slice(0, 32)}`,
      `translate([${num(x)}, ${num(ly)}, ${num(z)}])`,
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
  const holeOpts = `bundle_hole_options(refined_holes=${!bin.magnetHoles && !bin.screwHoles}, magnet_holes=${bin.magnetHoles}, screw_holes=${bin.screwHoles}, crush_ribs=true, chamfer_holes=true, printable_hole_top=true)`;

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

  // The library's bin_render() auto-translates its children by BASE_HEIGHT +
  // fill_height + TOLLERANCE so its own compartment cutters (which expect
  // compartment-local coords) land in the cavity. Our STL+text placements are
  // already in world coords, so we must NOT pass them as bin_render children
  // (they'd float ~5mm above where the preview shows them, missing the cavity
  // entirely). Instead: bin_render produces the bin (with optional standard
  // subdivisions), then we subtract our cavities in an outer difference().
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
    bin_render(bin_obj) {
      ${subdivisionBlock}
    }
    ${cavityBody || "// no custom cavities"}
  }
  ${embossBody ? `// Embossed text (added on top of bin)\n  ${embossBody}` : "// no embossed text"}
}
`;
}
