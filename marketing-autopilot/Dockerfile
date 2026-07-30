# API image.
#
# Docker rather than Render's stock Node runtime for one reason: the poster
# renderer needs Tamil and Latin fonts installed system-wide. Without them
# Sharp still succeeds and silently emits tofu boxes -- a wrong image, not an
# error -- so the fonts are a hard dependency of correctness, not a nicety.
FROM node:22-bookworm-slim

ENV NODE_ENV=production

# fontconfig is not present in node:*-slim and is needed twice over: it
# provides fc-cache/fc-list, and librsvg resolves family names like
# "Noto Sans Tamil" through it at runtime. Installing only the font packages
# leaves the fonts on disk but unfindable.
#
# The two fc-list checks fail the build now if a font the renderer asks for is
# missing. The runtime failure mode is a silently wrong image rather than an
# exception, which is far more expensive to notice.
#
# Comments are kept outside the RUN: a `#` line inside a line continuation is
# handled inconsistently across Docker parser versions and is a known way to
# break a build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       fontconfig fonts-noto-core fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && fc-list | grep -q "Noto Sans Tamil" \
    && fc-list | grep -q "DejaVu Sans"

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
