# Run the client and API together

Rules: greece-118-v31
Save version: 31
Database schema: 13

Build with Node24+ and pnpm11.7.0, then serve the complete matching source,
dependencies and built client from a durable release directory:

```sh
pnpm install --frozen-lockfile
pnpm build
node server/start.ts --assets dist --database /private/durable/game-greece-118-v31-schema13.sqlite \
  --host 127.0.0.1 --port 5396
```

Keep the database, WAL/SHM sidecars and backups private, outside dist. Use a fresh
database path when the gameplay identity changes; preserve older databases as
archives. Never reinterpret an older rules database or silently reset progress.
Schema migrations require the identical rules identity: never migrate a database
with different gameplay rules into this service.
The service requires Node24+, not the development Vite server.

For HTTPS, put the loopback service behind a TLS reverse proxy and pass the
exact external origin plus `--secure-cookie`. The templates in deploy/
require operator-specific hostnames, paths, Node location and service identity.
Check the actual Node executable before installing the systemd template; its
example /usr/bin/node is not available on every machine. Preserve other services.
Use a complete new release directory instead of modifying a running dist in place.

See [GitHub Pages and HTTPS API setup](GITHUB-PAGES.md) for the project base,
VITE_API_ORIGIN and exact allowed frontend origin. Pages hosts only the client;
the separately hosted Node service owns authentication, matchmaking and SQLite.
See [accounts and schema12 to schema13 migration](ACCOUNTS.md).

Online backup: `node server/snapshot.ts --database /private/durable/game-greece-118-v31-schema13.sqlite
--output /private/backups/fresh-name.sqlite`. Use a fresh output basename,
inspect its verified result, keep credential-bearing snapshots private and arrange
encrypted off-host retention. Recover to a new path while the old service is
stopped; preserve its database and sidecars. No off-host recovery is claimed here.
