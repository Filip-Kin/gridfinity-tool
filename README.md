# gridfinity-tool

Web tool that turns uploaded STL files into Gridfinity bins by using the STLs as cavities. Arrange multiple parts on the bin, add text labels (debossed into the floor or embossed on top), and export the final bin as an STL ready to print.

Built with Bun + React + Three.js (frontend) and OpenSCAD + [`gridfinity-rebuilt-openscad`](https://github.com/kennetek/gridfinity-rebuilt-openscad) (backend renderer).

## Local dev

Requires `bun` and `openscad` (or `openscad-nightly`) on PATH.

```bash
bun install
bun run dev
```

The Vite dev server runs on :5173 and proxies `/api` to the Bun server on :8090.

## Render flow

1. Upload one or more `.stl` files.
2. Arrange them on the bin (drag via gizmo, or numeric inputs). Set per-STL oversize % for tolerance.
3. Optionally add text labels (deboss = cut into bin floor, emboss = raised on top).
4. Hit **Render & Download STL**. Server writes a `.scad` file referencing the uploaded STLs, runs OpenSCAD, returns the resulting STL.

## Deploy (Coolify)

- Docker build context = repo root, Dockerfile = `./Dockerfile`.
- Port: `8090`.
- Domain: `gridfinity.filipkin.com` (HTTPS via Coolify).
- Persistent volume on `/app/tmp` if you want session uploads to survive container restarts (otherwise they're scratch).

## How oversize works

The "oversize %" on each STL is applied as a uniform `scale()` around the STL's centroid before subtraction. This is fast and good enough for tolerance values of 1–5%. For dimensionally critical cavities, model the tolerance into the STL beforehand.

## Library

`scad/gridfinity-rebuilt-openscad/` is vendored from upstream. Update by:

```bash
cd scad/gridfinity-rebuilt-openscad
git pull
```

## Layout

```
src/
  shared/types.ts       # BinConfig, PlacedObject, etc. shared between client + server
  server/
    index.ts            # Bun HTTP server, static + API
    sessions.ts         # tmp/ session lifecycle
    scad.ts             # builds the .scad file from a BinConfig + objects
    openscad.ts         # spawns openscad CLI
  client/
    main.tsx, App.tsx, styles.css
    lib/store.ts        # zustand state
    components/
      Sidebar.tsx       # bin config, uploads, per-object controls
      Scene.tsx         # R3F canvas
      BinPreview.tsx    # transparent bin walls
      PlacedObjects.tsx # draggable STLs + text labels (TransformControls)
scad/gridfinity-rebuilt-openscad/   # vendored library
tmp/                                # per-session uploads and rendered output
```
