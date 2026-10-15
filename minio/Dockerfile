# MinIO community edition, built from source.
#
# MinIO stopped publishing community images and binaries in 2026 (repo archived
# 2026-04-25, Docker Hub images deleted 2026-09-11), so this builds the last
# community release from its git tag and verifies the tag's commit.
#
# celld needs RELEASE.2025-09-07T16-13-09Z or later: the 2025-09-06 release
# answers a conditional create with NoSuchKey and breaks the first deploy
# (denoland/celld#162). 2025-10-15 is the final release and includes the fix
# for CVE-2025-62506.

ARG GO_VERSION=1.24
FROM golang:${GO_VERSION}-bookworm AS build
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
ENV CGO_ENABLED=0 GOTOOLCHAIN=auto
RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git /src
WORKDIR /src
RUN test "$(git rev-parse HEAD)" = "${MINIO_COMMIT}" \
      || { echo "tag ${MINIO_RELEASE} does not point at ${MINIO_COMMIT}" >&2; exit 1; }
# gen-ldflags takes the release time, e.g. 2025-10-15T17:29:55Z.
RUN version="$(echo "${MINIO_RELEASE#RELEASE.}" | sed -E 's/T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/T\1:\2:\3Z/')" \
 && ldflags="$(MINIO_RELEASE=RELEASE go run buildscripts/gen-ldflags.go "${version}")" \
 && go build -tags kqueue -trimpath -ldflags "${ldflags}" -o /out/minio \
 && /out/minio --version

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--address", ":9000", "--console-address", ":9001"]
