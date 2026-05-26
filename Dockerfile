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
ARG OPENSCAD_APPIMAGE=OpenSCAD-2025.07.20.ai26208-x86_64.AppImage
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       curl ca-certificates \
       openscad \
       fonts-liberation fonts-dejavu-core \
       libxcb-cursor0 libgpg-error0 \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fSL "https://files.openscad.org/snapshots/${OPENSCAD_APPIMAGE}" -o /tmp/openscad.AppImage \
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
