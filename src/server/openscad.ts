import { spawn } from "node:child_process";

const OPENSCAD_BIN = process.env.OPENSCAD_BIN ?? "openscad";
const RENDER_TIMEOUT_MS = parseInt(process.env.OPENSCAD_TIMEOUT_MS ?? "600000", 10);
// Manifold is the new (2024+) CSG backend in OpenSCAD; CGAL is the old/slow
// default. For boolean-heavy gridfinity bins (magnet holes + multiple STL
// cavities + rotated geometry), Manifold is often 10-100x faster.
const OPENSCAD_BACKEND = process.env.OPENSCAD_BACKEND ?? "Manifold";

export interface RenderResult {
  ok: boolean;
  stderr: string;
  durationMs: number;
}

export async function renderStl(scadPath: string, outPath: string): Promise<RenderResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(
      OPENSCAD_BIN,
      ["-o", outPath, "--export-format=binstl", "--backend", OPENSCAD_BACKEND, scadPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.stdout.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      stderr += `\n[timeout after ${RENDER_TIMEOUT_MS}ms]`;
    }, RENDER_TIMEOUT_MS);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stderr,
        durationMs: Date.now() - start,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stderr: `spawn error: ${err.message}\n${stderr}`,
        durationMs: Date.now() - start,
      });
    });
  });
}
