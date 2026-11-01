# syntax=docker/dockerfile:1

# Build:  docker build -t pictoe-api backend
# Run:    docker run --rm -p 8787:8787 -e PICTOE_ALLOWED_ORIGINS=https://app.example.com pictoe-api
#
# The base images are arguments only so they can be swapped (a mirror, or a test double);
# the defaults are what production uses.
ARG RUST_IMAGE=rust:1.89-slim-bookworm
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian12:nonroot

# ---- build ----------------------------------------------------------------
# hadolint ignore=DL3006
FROM ${RUST_IMAGE} AS build
WORKDIR /app

# 1) Compile the dependencies on their own, against empty stand-in sources. This layer is only
#    rebuilt when Cargo.toml or Cargo.lock change, not on every code edit. The stand-in crate's
#    own artifacts are deleted afterwards: otherwise cargo can decide the real sources are
#    "unchanged" (their timestamps are older than the stand-ins') and ship the empty program.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
 && echo 'fn main() {}' > src/main.rs \
 && : > src/lib.rs \
 && cargo build --release --locked \
 && rm -rf src \
    target/release/pictoe-api target/release/pictoe-api.d \
    target/release/libpictoe_api.rlib target/release/libpictoe_api.d \
    target/release/deps/pictoe_api* target/release/deps/libpictoe_api* \
    target/release/.fingerprint/pictoe-api-*

# 2) The real build.
COPY src ./src
RUN cargo build --release --locked

# ---- run ------------------------------------------------------------------
# No shell, no package manager, no root: just the program and the C runtime it needs.
# hadolint ignore=DL3006
FROM ${RUNTIME_IMAGE}
COPY --from=build /app/target/release/pictoe-api /usr/local/bin/pictoe-api

# Listen on every interface inside the container. (The program's own default is localhost only,
# which would be unreachable from outside.) Publish the port with -p, and set
# PICTOE_ALLOWED_ORIGINS to the editor's origin; see backend/README.md for every setting.
ENV PICTOE_ADDR=0.0.0.0:8787
EXPOSE 8787

# Numeric, so platforms that refuse a non-numeric USER accept it. 65532 is "nonroot" in distroless.
USER 65532:65532

# The image has no curl, so the program checks itself.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/pictoe-api", "--healthcheck"]

ENTRYPOINT ["/usr/local/bin/pictoe-api"]
