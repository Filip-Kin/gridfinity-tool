import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { createSession, ensureRoot, pruneOld, sessionDir, sessionExists } from "./sessions";
import { renderStl } from "./openscad";
import { buildScad } from "./scad";
import type { RenderRequest, UploadResponse } from "../shared/types";

const PORT = parseInt(process.env.PORT ?? "8090", 10);
const PROJECT_ROOT = resolve(import.meta.dir, "..", "..");
const LIBRARY_PATH = join(PROJECT_ROOT, "scad", "gridfinity-rebuilt-openscad");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

await ensureRoot();
await pruneOld();
setInterval(() => {
  pruneOld().catch(() => {});
}, 60 * 60 * 1000);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function handleSession(): Promise<Response> {
  const id = await createSession();
  return json({ sessionId: id });
}

async function handleUpload(req: Request): Promise<Response> {
  const form = await req.formData();
  const sessionId = form.get("sessionId");
  if (typeof sessionId !== "string" || !(await sessionExists(sessionId))) {
    return badRequest("invalid sessionId");
  }
  const files = form.getAll("files");
  const dir = sessionDir(sessionId);
  const out: UploadResponse["files"] = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    if (f.size > MAX_UPLOAD_BYTES) return badRequest(`file ${f.name} exceeds ${MAX_UPLOAD_BYTES} bytes`);
    if (!/\.stl$/i.test(f.name)) return badRequest(`only .stl files allowed (${f.name})`);
    const filename = `${Date.now()}_${safeName(f.name)}`;
    const buf = new Uint8Array(await f.arrayBuffer());
    await writeFile(join(dir, filename), buf);
    out.push({ filename, originalName: f.name, sizeBytes: f.size });
  }
  return json({ sessionId, files: out } satisfies UploadResponse);
}

async function handleStl(sessionId: string, filename: string): Promise<Response> {
  if (!(await sessionExists(sessionId))) return notFound();
  const safe = safeName(filename);
  const path = join(sessionDir(sessionId), safe);
  const file = Bun.file(path);
  if (!(await file.exists())) return notFound();
  return new Response(file, {
    headers: {
      "Content-Type": "model/stl",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function handleRender(req: Request): Promise<Response> {
  const body = (await req.json()) as RenderRequest;
  if (!body.sessionId || !(await sessionExists(body.sessionId))) {
    return badRequest("invalid sessionId");
  }
  const dir = sessionDir(body.sessionId);

  for (const obj of body.objects) {
    if (obj.kind === "stl") {
      const p = join(dir, safeName(obj.filename));
      try {
        await stat(p);
      } catch {
        return badRequest(`missing stl: ${obj.filename}`);
      }
    }
  }

  const scad = buildScad({
    bin: body.bin,
    objects: body.objects,
    stlPathFor: (filename) => join(dir, safeName(filename)),
    libraryPath: LIBRARY_PATH,
  });

  const scadPath = join(dir, `bin_${Date.now()}.scad`);
  const stlPath = scadPath.replace(/\.scad$/, ".stl");
  await writeFile(scadPath, scad);

  const result = await renderStl(scadPath, stlPath);
  if (!result.ok) {
    return json(
      {
        error: "openscad failed",
        stderr: result.stderr,
        scad: relative(PROJECT_ROOT, scadPath),
      },
      500,
    );
  }

  const stlBuf = await readFile(stlPath);
  return new Response(new Uint8Array(stlBuf), {
    headers: {
      "Content-Type": "model/stl",
      "Content-Disposition": `attachment; filename="gridfinity-bin.stl"`,
      "X-Render-Duration-Ms": String(result.durationMs),
    },
  });
}

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

async function serveStatic(reqPath: string): Promise<Response> {
  let p = reqPath === "/" ? "/index.html" : reqPath;
  const target = resolve(DIST_DIR, "." + p);
  if (!target.startsWith(DIST_DIR)) return notFound();
  try {
    const s = await stat(target);
    if (s.isDirectory()) return notFound();
    const ext = target.slice(target.lastIndexOf(".")).toLowerCase();
    const type = STATIC_TYPES[ext] ?? "application/octet-stream";
    const buf = await readFile(target);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": type } });
  } catch {
    if (p !== "/index.html") return serveStatic("/index.html");
    return notFound();
  }
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (req.method === "POST" && path === "/api/session") return handleSession();
      if (req.method === "POST" && path === "/api/upload") return handleUpload(req);
      if (req.method === "POST" && path === "/api/render") return handleRender(req);
      const stlMatch = path.match(/^\/api\/stl\/([a-f0-9-]{36})\/(.+)$/i);
      if (req.method === "GET" && stlMatch) return handleStl(stlMatch[1]!, stlMatch[2]!);
      if (req.method === "GET" && path.startsWith("/api/")) return notFound();
      if (req.method === "GET") return serveStatic(path);
      return notFound();
    } catch (err) {
      console.error("request error", err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
});

console.log(`gridfinity-tool listening on http://localhost:${server.port}`);
console.log(`  library: ${LIBRARY_PATH}`);
console.log(`  openscad: ${process.env.OPENSCAD_BIN ?? "openscad"}`);
