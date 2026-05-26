# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
RUN bun run build

FROM oven/bun:1.3 AS runtime
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       openscad-nightly \
       fonts-liberation \
       fonts-dejavu-core \
       xvfb \
  || (apt-get install -y --no-install-recommends openscad fonts-liberation fonts-dejavu-core xvfb) \
  && rm -rf /var/lib/apt/lists/*

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
