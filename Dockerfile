# syntax=docker/dockerfile:1
#
# Multi-stage build for container / VPS hosting (test 22: output "standalone").
#   docker build --target runner -t nextjs-compat .                       (main app)
#   docker build --target runner-cache-components -t nextjs-compat-cc .   (test 8 variant)
#
# Security notes (see SECURITY.md S21):
#  - base image pinned by digest, so a moved tag cannot change what we build on
#  - build tools and dev dependencies stay in earlier stages, not in the final image
#  - runs as the unprivileged "node" user (uid 1000)
#  - NO secrets at build time: the only build arg is NEXT_PUBLIC_BUILD_LABEL (public by
#    design). Runtime secrets (REVALIDATE_TOKEN, ...) are passed with `docker run -e`.
#  - Behind a TLS-inspecting proxy? Pass an extra CA as a BUILD SECRET (mounted for one
#    command only, never stored in a layer):
#      docker build --secret id=extra_ca,src=/path/ca.pem --build-arg HTTPS_PROXY=... .
#    (HTTPS_PROXY is one of Docker's predefined build args and is not saved in the image.)

ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# ---- deps: install exact versions from the lockfile; never run dependency lifecycle scripts
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY variants/cache-components/package.json variants/cache-components/package.json
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --ignore-scripts

# ---- build
FROM deps AS build
ARG NEXT_PUBLIC_BUILD_LABEL=docker
ENV NEXT_TELEMETRY_DISABLED=1 \
    BUILD_OUTPUT=standalone \
    NEXT_PUBLIC_BUILD_LABEL=${NEXT_PUBLIC_BUILD_LABEL}
COPY tsconfig.json next.config.ts ./
COPY public ./public
COPY src ./src
COPY variants ./variants
# next/font/google downloads the font files at build time, so the build needs network access.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm run build && npm run build:cache-components

# ---- runner (main app)
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Next.js writes its image/fetch caches here; keep it writable even with --read-only.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]

# ---- runner (cache-components variant)
FROM ${NODE_IMAGE} AS runner-cache-components
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/variants/cache-components/.next/standalone ./
COPY --from=build --chown=node:node /app/variants/cache-components/.next/static ./variants/cache-components/.next/static
RUN mkdir -p variants/cache-components/.next/cache && chown node:node variants/cache-components/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "variants/cache-components/server.js"]
