# celld on Komodo, behind Nginx Proxy Manager

One Docker host running a single-node [celld](https://github.com/denoland/celld) fleet (v0.6.2)
on a local MinIO bucket.

```
Internet ─► NPM (TLS) ──PROXY_NETWORK──► celld :8080        public Workers / Durable Objects
                                          celld :8081  ┐
                         celld_internal ─ minio :9000  ├─ internal: true, no internet, not reachable from NPM
                         (172.30.70.0/24)  tools       ┘
```

| File | What it is |
|---|---|
| `compose.yaml` | Fleet stack: `minio` (built from source), `tools` (builds the CLI image, creates the bucket), `celld`, optional `backup` → B2 |
| `komodo/resources.toml` | Fleet stack as a Komodo resource |
| `minio/Dockerfile` | MinIO `RELEASE.2025-10-15T17-29-55Z` built from its git tag, commit pinned |
| `tools/` | `celld` CLI + esbuild + `ensure-bucket.mjs` |

## Before you start: the storage caveat

celld's docs say MinIO community **passes celld's storage test but is not qualified for
production**. B2, Hetzner Object Storage and DO Spaces are disqualified outright (no working
conditional writes). This stack is fine for building and staging. For production data, either
accept the risk (single host, single disk, plus the B2 backup below), or swap the bucket for a
qualified store: S3, R2, Tigris, GCS or Azure. Swapping is three env vars (`CELLD_BUCKET`,
`S3_ENDPOINT`, credentials); apps don't change.

Every celld node also runs the conditional-write and ranged-read test against the bucket
before it serves, and refuses to start if the store fails it. A bad bucket can't silently
corrupt data.

MinIO stopped publishing community images in 2026, so `minio/Dockerfile` builds the final
community release from source. The first build takes a few minutes.

## Setup

1. **Find NPM's Docker network** on the host: `docker network ls`, then
   `docker inspect <npm-container> -f '{{json .NetworkSettings.Networks}}'`. Put that name in
   `PROXY_NETWORK`; the default in the TOML is `npm_default`. If NPM runs in host networking or
   on another machine, see [NPM elsewhere](#npm-elsewhere).
2. **Fill the `REPLACE_ME` values** (server, git account) in
   `komodo/resources.toml`. The repo is `github.com/svnix-solutions/celld_build`.
3. **Create Komodo secret variables**: `CELLD_MINIO_ROOT_USER` and `CELLD_MINIO_ROOT_PASSWORD`
   (40+ random characters). Add `CELLD_B2_KEY_ID` and `CELLD_B2_APPLICATION_KEY` only if you
   enable backups.
4. **Add the resource**: a Resource Sync on `komodo/resources.toml`, or create the stack by
   hand from the TOML.
5. **Deploy `celld-fleet`.** Order: MinIO goes healthy, `tools` creates the bucket and exits 0,
   then `celld` starts. celld waits 12 s at every start (its supervisor contract) and reports
   healthy about 60 s after that.
6. **Webhook**: copy the stack's webhook URL into this GitHub repo (Settings → Webhooks,
   content type `application/json`, push events).

## Nginx Proxy Manager

Hosts → Proxy Hosts → Add:

| Field | Value |
|---|---|
| Domain | e.g. `apps.svnix.solutions` (one host can serve many domains; route by `Host` in the Worker) |
| Scheme / Forward host / Port | `http` / `celld-fleet` / `8080` |
| Websockets Support | **On** (Durable Object WebSockets) |
| Block Common Exploits | On |
| SSL | Let's Encrypt, Force SSL, HTTP/2 |

Advanced tab:

```nginx
client_max_body_size 64m;
proxy_read_timeout 3600s;   # hibernatable WebSockets stay open
proxy_send_timeout 3600s;
proxy_buffering off;        # stream responses straight through
```

`celld-fleet` is a network alias on `PROXY_NETWORK`, so it can't collide with other
stacks' service names. Never proxy port 8081: it carries the unauthenticated operator API.
celld also does no end-user auth, so put NPM Access Lists or auth in front of anything
non-public.

### NPM elsewhere

If NPM isn't on a Docker network with this host's containers, publish the public listener and
point NPM at the host's private or WireGuard IP. Add this under the `celld` service, and keep
the address private:

```yaml
    ports:
      - "10.8.0.5:8080:8080"
```

## Day-2

```sh
cd /etc/komodo/stacks/celld-fleet      # Komodo's checkout of this stack

# Storage test + fleet report (conditional writes, peers, memory, cells)
docker compose run --rm --no-deps tools celld diagnose

# Node state / force adoption (reachable only from celld_internal)
docker compose run --rm --no-deps tools curl -s http://172.30.70.10:8081/state
docker compose run --rm --no-deps tools curl -s -X POST http://172.30.70.10:8081/reload
```

- **celld upgrade**: bump `CELLD_VERSION`. The node drains on SIGTERM
  for up to 40 s (`stop_grace_period: 50s`). Read celld's release notes first: it's alpha, and
  security fixes go only to the latest release.
- **Backups**: set `COMPOSE_PROFILES=backup` plus the `B2_*` values, and keep versioning on for
  the B2 bucket. rclone syncs the whole fleet bucket every 6 h. Restore = sync back into an empty
  bucket, then start the node.
- **Scaling out** needs nodes on other hosts reaching the bucket and each other over WireGuard.
  At that point MinIO on one box becomes the bottleneck and the single point of failure, so move
  the bucket to a qualified store first.

## Notes

- MinIO uses root credentials because it serves only this fleet. celld treats bucket access as
  fleet-admin access either way.
- `RUST_LOG=debug` on the `celld` service for verbose logs.
