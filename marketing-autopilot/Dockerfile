# API image.
#
# Docker rather than Render's stock Node runtime for one reason: the poster
# renderer needs Tamil and Latin fonts installed system-wide. Without them
# Sharp still succeeds and silently emits tofu boxes -- a wrong image, not an
# error -- so the fonts are a hard dependency of correctness, not a nicety.
FROM node:22-bookworm-slim

# NODE_ENV is deliberately NOT set here. `npm ci` omits devDependencies when
# NODE_ENV=production, so setting it this early silently strips typescript and
# every @types/* package, and the build then fails on TS7016. It is set once
# the build is done, further below, so the runtime still gets production mode.

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
       fontconfig fonts-noto-core fonts-dejavu-core openssl \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && fc-list | grep -q "Noto Sans Tamil" \
    && fc-list | grep -q "DejaVu Sans"

WORKDIR /app

COPY package*.json ./
# --include=dev is explicit on purpose: prisma generate and tsc need the dev
# dependencies, and relying on NODE_ENV merely being unset is exactly how this
# broke the first time.
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate && npx tsc -p tsconfig.json

# Drop dev dependencies once the build artefacts exist.
RUN npm prune --omit=dev

# Set only now: the app reads this at runtime (it selects JSON logging over
# pino-pretty, which is a dev dependency and no longer installed).
ENV NODE_ENV=production

EXPOSE 8080
CMD ["node", "dist/server.js"]
