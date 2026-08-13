# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
RUN bun run build

FROM oven/bun:1.3 AS runtime

# Install the apt `openscad` package primarily to pull in all the GL/Qt/xcb
# runtime libs cleanly (the apt binary itself is too old). Then overlay the
# upstream snapshot AppImage and wrap it. gridfinity-rebuilt-openscad v2.0.0
# uses dynamic scope features (cgs() inside bin_subdivide) that need a recent
# OpenSCAD build.
# NOTE: OpenSCAD rotates old nightly snapshots off files.openscad.org, so pinning
# a specific filename bit-rots (the URL 404s once it ages out). We resolve the
# NEWEST available snapshot at build time instead. Set OPENSCAD_APPIMAGE to pin a
# specific file if you ever need reproducibility.
ARG OPENSCAD_APPIMAGE=
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       curl ca-certificates \
       openscad \
       fonts-liberation fonts-dejavu-core \
       libxcb-cursor0 libgpg-error0 \
  && rm -rf /var/lib/apt/lists/* \
  && APPIMAGE="${OPENSCAD_APPIMAGE:-$(curl -fsSL https://files.openscad.org/snapshots/ | grep -oE 'OpenSCAD-[0-9.]+\.ai[0-9]+-x86_64\.AppImage' | sort -V | tail -1)}" \
  && echo "Using OpenSCAD snapshot: ${APPIMAGE}" \
  && curl -fSL "https://files.openscad.org/snapshots/${APPIMAGE}" -o /tmp/openscad.AppImage \
  && chmod +x /tmp/openscad.AppImage \
  && cd /opt && /tmp/openscad.AppImage --appimage-extract > /dev/null \
  && mv /opt/squashfs-root /opt/openscad \
  && rm /tmp/openscad.AppImage \
  && printf '#!/bin/bash\nexec /opt/openscad/AppRun "$@"\n' > /usr/local/bin/openscad \
  && chmod +x /usr/local/bin/openscad

ENV OPENSCAD_BIN=openscad
ENV PORT=8090
ENV NODE_ENV=production

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production
COPY src/server/ ./src/server/
COPY src/shared/ ./src/shared/
COPY scad/ ./scad/
COPY --from=build /app/dist ./dist
RUN mkdir -p ./tmp

EXPOSE 8090
CMD ["bun", "run", "src/server/index.ts"]
