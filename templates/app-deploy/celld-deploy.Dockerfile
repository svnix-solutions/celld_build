ARG CELLD_VERSION=0.6.2
FROM local/celld-tools:${CELLD_VERSION}
ARG APP_DIR
COPY ${APP_DIR}/ /app/
WORKDIR /app
# Install the app's own dependencies when it has a lockfile.
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    elif [ -f package.json ]; then npm install --no-audit --no-fund; fi
# Fail the image build (and the Komodo deploy) on a bad bundle or config,
# before anything reaches the bucket.
RUN celld deploy . --dry-run
CMD ["deploy.sh", "/app"]
