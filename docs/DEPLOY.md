# Deploying Tiq Taq Two

Three setups, from simplest to most complete. All need **Node ≥ 22.18** wherever the server runs (it executes TypeScript directly).

| Setup | Peer-to-peer rooms | Server rooms + public lobby | Where it runs |
| --- | :---: | :---: | --- |
| A. GitHub Pages only | ✓ | – | static hosting |
| B. Your server only | ✓ | ✓ | one Node process serves app + lobby |
| C. Pages + your server | ✓ | ✓ | app on Pages, lobby on your box |

Everything else (bot, lessons, sandbox, pass-and-play) works in all of them — even offline once loaded.

## A. GitHub Pages

1. Push the repo to GitHub.
2. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy-pages.yml` runs the tests, builds, and publishes.

This repository is deployed exactly this way: <https://mihir-null.github.io/tiq-taq-two/>. Each push to `main` shows up under the repo's **Actions** tab as "Deploy to GitHub Pages" (a `build` job, then a `deploy` job); if a run fails, its log shows which step broke.

The build uses relative asset paths (`base: './'`) and hash routes (`#/room/p2p/K7Q2X`), so it works under `https://<you>.github.io/<repo>/` with no configuration and no 404 tricks.

Peer-to-peer rooms use the free public PeerJS signalling server (`0.peerjs.com`) only to introduce browsers; the game traffic then flows directly between them over WebRTC.

## B. Your own server

```bash
git clone https://github.com/Mihir-Null/tiq-taq-two && cd tiq-taq-two
npm ci
npm run build          # → dist/
npm run server         # node server/main.ts → http://localhost:8787
```

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | bind address (`127.0.0.1` behind a reverse proxy) |
| `STATIC_DIR` | `dist` | built app to serve |
| `SERVER_NAME` | `Tiq Taq Two lobby` | name shown in the lobby |
| `ALLOWED_ORIGINS` | `*` | comma-separated web origins allowed to use the API/WS |
| `MAX_ROOMS` | `300` | simultaneous rooms |
| `TRUST_PROXY` | – | `1` to use `X-Forwarded-For` for per-IP limits |

### HTTPS and WebSockets behind a reverse proxy

Browsers require `wss://` on `https://` pages. Put a reverse proxy in front:

- **Caddy** (automatic certificates, WebSockets just work): see `deploy/Caddyfile.example`.
- **nginx**: see `deploy/nginx.conf.example` — the `Upgrade`/`Connection` headers are the important part.

### systemd

`deploy/tiq-taq-two.service` is a hardened unit (DynamicUser, read-only system) assuming the checkout lives in `/srv/tiq-taq-two`.

### Docker

```bash
docker build -t tiq-taq-two .
docker run -d --name tiq -p 8787:8787 tiq-taq-two
```

### NixOS

The flake exports a package and a module:

```nix
# your system flake
inputs.tiq-taq-two.url = "github:Mihir-Null/tiq-taq-two";

nixosConfigurations.box = nixpkgs.lib.nixosSystem {
  modules = [
    inputs.tiq-taq-two.nixosModules.default
    {
      services.tiq-taq-two = {
        enable = true;
        port = 8787;
        serverName = "Mihir's quantum lobby";
        # allowedOrigins = [ "https://mihir-null.github.io" ];   # for setup C
      };
      services.caddy = {
        enable = true;
        virtualHosts."tiq.example.com".extraConfig = "reverse_proxy 127.0.0.1:8787";
      };
    }
  ];
};
```

First build: `nix build` fails once and prints the real `npmDepsHash`; paste it into `nix/package.nix` and build again (standard for npm projects in Nix). `nix develop` gives a dev shell with Node.

On a Proxmox/NixOS homelab, the lobby is a tiny service — a few MB of RAM per hundred players.

## C. Pages + your server

1. Deploy the server (B) at, say, `https://tiq.example.com`, with `ALLOWED_ORIGINS=https://mihir-null.github.io`.
2. In the GitHub repo: *Settings → Secrets and variables → Actions → Variables* → `VITE_SERVER_URL` = `https://tiq.example.com`.
3. Re-run the Pages workflow. The Pages site now shows the public lobby and server rooms too.

Players can also point any build at a server themselves: *Online → Custom server address*.

## Peer-to-peer troubleshooting

- **"No room with that code"** — the host's tab must stay open; P2P rooms live there.
- **Connects on Wi-Fi but not on mobile data / at work** — some networks (symmetric NAT, strict firewalls) block direct WebRTC. Add a TURN relay via `VITE_ICE_SERVERS` (see `.env.example`); coturn is easy to self-host. Or use server rooms, which only need a WebSocket.
- **Don't want to depend on the public PeerJS server?** Run your own (`npx peerjs --port 9000`) and set `VITE_PEER_HOST/PORT/PATH/SECURE`.

## Single-file build

`npm run build:single` produces `dist-single/index.html` with all JS, CSS and fonts inlined — handy for dropping onto any web space. Online play works the same way (P2P needs network access to the signalling server).
