# celld CLI + esbuild + helpers. Used for bucket init, `celld deploy`,
# `celld diagnose` and the other operator subcommands.
ARG CELLD_VERSION=0.6.2
FROM ghcr.io/denoland/celld:${CELLD_VERSION} AS celld

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=celld /usr/local/bin/celld /usr/local/bin/celld
WORKDIR /opt/celld-tools
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin/ ./bin/
RUN chmod +x bin/*.sh
ENV PATH=/opt/celld-tools/node_modules/.bin:/opt/celld-tools/bin:$PATH
RUN celld --version && esbuild --version
ENTRYPOINT []
CMD ["celld", "--help"]
