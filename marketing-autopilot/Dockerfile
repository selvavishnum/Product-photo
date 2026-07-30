# API image.
#
# Docker rather than Render's stock Node runtime for one reason: the poster
# renderer needs Tamil and Latin fonts installed system-wide. Without them
# Sharp still succeeds and silently emits tofu boxes -- a wrong image, not an
# error -- so the fonts are a hard dependency of correctness, not a nicety.
FROM node:22-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-noto-core fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app

COPY package*.json ./
# Dev deps are needed at build time: prisma generate and tsc.
RUN npm ci

COPY . .
RUN npx prisma generate && npx tsc -p tsconfig.json

# Drop dev dependencies once the build artefacts exist.
RUN npm prune --omit=dev

EXPOSE 8080
CMD ["node", "dist/server.js"]
