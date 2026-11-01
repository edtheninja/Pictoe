# pictoe-api: the optional cloud gateway (B0 spike)

Pictoe's editor runs entirely in the browser and never needs this service. It exists for the
operations that **can't** run there (object removal, generative expansion, sky replacement,
subject isolation), behind a small job API. Nothing here is required for editing, undo or export.

**This is a spike, not a product.** It proves the shape of the service and makes the Rust
decision with evidence. It contains **no AI and no fake results**: cloud-only operations are
recognised and refused with an honest message, exactly like the editor's Intent Bar. Only the
harmless `noop` operation exercises the job lifecycle.

## The API contract

The Rust types are the single source of truth. `openapi.json` is generated from them, and the
editor's TypeScript types (`../src/api/schema.d.ts`) are generated from that file. The running
service also serves the spec at `GET /openapi.json`.

After changing a route, request, response or error code:

```sh
cd backend
cargo run --example openapi > openapi.json   # regenerate the spec
cd .. && npm run api:types                   # regenerate the editor's types
```

`cargo test` fails if `openapi.json` is stale, and `tests/contract.rs` sends real requests and
checks that every status, error code and header the service produces is documented (and that
nothing documented is made up). CI fails if the editor's generated types are stale.

## Run it

Needs Rust 1.85 or newer.

```sh
cd backend
cargo run                      # listens on 127.0.0.1:8787
cargo test                     # 34 tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Allow your dev server's origin (the default already allows `http://localhost:8080`):

```sh
PICTOE_ALLOWED_ORIGINS=http://localhost:8080,https://pictoe.example cargo run
```

| Variable | Default | Meaning |
|---|---|---|
| `PICTOE_ADDR` | `127.0.0.1:8787` | Address to listen on |
| `PICTOE_ALLOWED_ORIGINS` | `http://localhost:8080` | Comma-separated browser origins. Explicit only: no `*`, no paths |
| `PICTOE_MAX_BODY_BYTES` | `65536` | Largest request body accepted |
| `PICTOE_REQUEST_TIMEOUT_SECS` | `30` | Per-request timeout |
| `PICTOE_MAX_JOBS` | `1000` | Most *active* jobs at once |
| `PICTOE_JOB_TTL_SECS` | `3600` | How long a finished job stays readable |
| `RUST_LOG` | `info` | Log level |

Bad configuration exits with code 2 and a plain message; a port already in use exits with 1.

## Run it in Docker

```sh
docker build -t pictoe-api backend
docker run --rm -p 8787:8787 -e PICTOE_ALLOWED_ORIGINS=https://pictoe.example pictoe-api
```

The image is a two-stage build. Dependencies are compiled in their own layer, so editing code
doesn't rebuild them. The final image is a distroless runtime (no shell, no package manager)
holding one stripped binary, running as the unprivileged user `65532`.

- **Listening address.** Inside the container the service listens on `0.0.0.0:8787`
  (`PICTOE_ADDR` is set by the image); publish the port with `-p`. Everything in the table above
  can be overridden with `-e`.
- **Set `PICTOE_ALLOWED_ORIGINS`.** The default allows only `http://localhost:8080`, so a deployed
  editor on any other address is refused by the browser until you list its origin.
- **Health check.** The image has no `curl`, so `HEALTHCHECK` runs the program itself:
  `pictoe-api --healthcheck` exits 0 when `/health` answers `200` and 1 otherwise. Platforms that
  probe over HTTP can use `GET /health` directly.
- **Stopping.** The service finishes in-flight requests on `SIGTERM` and exits 0, so
  `docker stop` returns at once instead of waiting out its timeout.
- **Pinning.** The base images are tagged, not pinned by digest. Pin them (`--build-arg
  RUST_IMAGE=...@sha256:...`) if you need byte-for-byte reproducible builds.

## API

| Request | Result |
|---|---|
| `GET /health` | `200 {"status":"ok","version":"…"}` |
| `POST /jobs` `{"operation":"noop"}` | `202 {"id","status":"queued"}` + `Location: /jobs/{id}` |
| `POST /jobs` with a cloud-only operation (`segment_subject`, `remove_object`, `replace_sky`, `expand_canvas`) | `501 cloud_engine_unavailable` |
| `POST /jobs` with anything else | `400 unknown_operation` |
| `GET /jobs/{id}` | `200 {"id","status"}` where status is `queued`, `running`, `done` or `cancelled` |
| `DELETE /jobs/{id}` | `204` if cancelled now, `409` if already finished, `404` if unknown or expired |

Every error has one shape, with messages written in the same plain language as the editor:

```json
{ "error": { "code": "cloud_engine_unavailable", "message": "This tool needs Pictoe's cloud engine, which isn't available yet. Your current edits remain safe." } }
```

## What it already does

- **Strict input.** A body must be a JSON object with a string `operation`. A bare list such as
  `["noop"]` is rejected (serde would otherwise accept it; a test caught this).
- **Safe by default.** CORS allowlist, request-size limit, request timeout, a cap on active
  jobs (`503` + `Retry-After`), finished jobs expire after a TTL, and user input is never reflected
  back unsafely.
- **Real cancellation.** Cancelling stops the underlying work, not just the status. A test proves
  it, because with a paid model call a cancel that only *hides* work costs money.
- **Privacy.** Method, path, status and timing are logged. Request bodies never are.
- **Clean lifecycle.** Graceful shutdown on Ctrl-C and SIGTERM (what container platforms send).

## Measured here

Measured in the development sandbox on a trivial endpoint (`GET /health`, 50,000 requests,
64 keep-alive connections, `ab`). **Treat these as order-of-magnitude, not as your hardware or a
real workload.**

| | |
|---|---|
| Release binary | 2.1 MB (LTO, stripped) |
| Idle memory | 4.1 MB |
| Memory after 50,000 requests | 6.1 MB |
| Throughput | about 40,000 requests/s, 0 failures, p99 3 ms |
| Start to first response | under 0.6 s |
| Release build | about 3 minutes with LTO (drop `lto` and `codegen-units` in `Cargo.toml` for faster local builds) |
| Code | about 1,100 lines including tests |

## What this does and doesn't tell you

- **It shows** Rust is comfortable for this job: tiny memory, one small binary, no runtime to
  install, and cancellation and expiry that are easy to reason about and test.
- **It doesn't show** that Rust is *faster for the product*. Real operations spend their time in
  the model provider, so the language won't change that latency. The honest cost is build time
  and more code than a thin TypeScript gateway.
- **It doesn't compare** against a TypeScript gateway. If you want that comparison, build the same
  `/health` and `/jobs` in TypeScript and measure it the same way.

## Still to do (see ../ROADMAP.md, Backend track)

- **B1:** done: CI (`fmt`, `clippy`, `test`) and the Dockerfile above. Still undecided: where to host it.
- **B2:** an OpenAPI spec and generated TypeScript types for the editor, and the decision on how
  cloud results stay non-destructive in the edit model.
- **B3:** the provider adapter, server-side API keys, rate limits per client and a daily spend cap.
- **B4:** image upload handling with short retention, consent copy in the editor, and no image
  content in logs.
- **Auth:** none yet. Decide how anonymous use is protected once calls cost money.
