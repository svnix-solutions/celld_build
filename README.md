# celld on Komodo, behind Nginx Proxy Manager

One Docker host running a single-node [celld](https://github.com/denoland/celld) fleet (v0.6.2)
on a local SeaweedFS bucket.

```
Internet ─► NPM (TLS) ──PROXY_NETWORK──► celld :8080        public Workers / Durable Objects
                                          celld :8081  ┐
                     celld_internal ─ seaweedfs :8333  ├─ internal: true, no internet, not reachable from NPM
                         (172.30.70.0/24)  tools       ┘
```

| File | What it is |
|---|---|
| `compose.yaml` | Fleet stack: `seaweedfs`, `tools` (builds the CLI image, creates the bucket), `celld`, optional `backup` → B2 |
| `komodo/resources.toml` | Fleet stack as a Komodo resource |
| `tools/` | `celld` CLI + esbuild + `ensure-bucket.mjs` |

## Before you start: the storage caveat

The bucket is SeaweedFS 4.48 (`chrislusf/seaweedfs`), run all-in-one: master, volume, filer and
S3 gateway in one container on one disk. Its S3 gateway checks `If-None-Match` / `If-Match` and
applies the PUT under a per-object write lock, which is the compare-and-swap celld's leases need.

**celld has not qualified SeaweedFS.** Its qualified stores are S3, R2, Tigris, GCS and Azure.
B2, Hetzner Object Storage and DO Spaces are disqualified. Every celld node runs the
conditional-write and ranged-read test against the bucket before it serves, and refuses to
start if the store fails it, so a bad store fails loudly instead of corrupting data. Also run
`celld diagnose` (see Day-2) after the first deploy.

Treat this as staging until it has soaked. To move to a qualified store later, change
`CELLD_BUCKET`, `S3_ENDPOINT` and the credentials; apps don't change.

## Setup

1. **Find NPM's Docker network** on the host: `docker network ls`, then
   `docker inspect <npm-container> -f '{{json .NetworkSettings.Networks}}'`. Put that name in
   `PROXY_NETWORK`; the default in the TOML is `npm_default`. If NPM runs in host networking or
   on another machine, see [NPM elsewhere](#npm-elsewhere).
2. **Fill the `REPLACE_ME` values** (server, git account) in
   `komodo/resources.toml`. The repo is `github.com/svnix-solutions/celld_build`.
3. **Create Komodo secret variables**: `CELLD_S3_ACCESS_KEY` and `CELLD_S3_SECRET_KEY`
   (40+ random characters). Add `CELLD_B2_KEY_ID` and `CELLD_B2_APPLICATION_KEY` only if you
   enable backups.
4. **Add the resource**: a Resource Sync on `komodo/resources.toml`, or create the stack by
   hand from the TOML.
5. **Deploy `celld-fleet`.** Order: SeaweedFS goes healthy, `tools` creates the bucket and exits 0,
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
  At that point SeaweedFS on one box becomes the bottleneck and the single point of failure, so move
  the bucket to a qualified store first.

## Notes

- `S3_ACCESS_KEY` / `S3_SECRET_KEY` become a SeaweedFS **admin** identity, used by celld,
  `tools` and the backup. Setting it turns S3 auth on, so anonymous requests are denied. The S3
  port is never published; it is reachable only on `celld_internal`.
- Scoped users and policies (deploy keys, read-only backup key) are managed with `weed shell`:

  ```sh
  docker exec -it celld-fleet-seaweedfs-1 weed shell
  > s3.user.create -name astami
  > s3.policy -put -name celld-deploy -file /data/celld-deploy.json
  > s3.policy.attach -policy celld-deploy -user astami
  > s3.config.show
  ```

  In this all-in-one mode, check that policies survive a restart before relying on them.
- `RUST_LOG=debug` on the `celld` service for verbose logs.
