# Username and password accounts

This export uses greece-118-v31, save31, database
schema13. Account data belongs to the online service;
local Freeplay/tutorial saves remain separate.

Open Account on the menu to create an account or sign in. Creating credentials
while a guest is open attaches them to the same guest ID, preserving the online
polis, profile and receipts. Signing in on another browser restores that online
identity. Signing out revokes this device's session; other account sessions remain.
Usernames use 3–32 letters, numbers or underscores and compare case-insensitively.
Passwords use 15–128 characters. The service stores salted password derivations,
never plaintext passwords. Claiming a guest revokes its anonymous token and recovery code.
Guest recovery is available only for unclaimed guests. Protect your credentials
and check the account after an interrupted response.

The endpoints are POST /api/account/signup, POST /api/account/login,
GET /api/account/session and POST /api/account/logout. Account clients keep an
API-origin-scoped bearer session in localStorage; JavaScript on that client
origin can read it, so keep that origin free of untrusted scripts. Passwords are
not persisted in browser storage. Same-origin guest cookies remain HttpOnly.
Production must use HTTPS, exact Origin/CORS settings and no credential logging.

## Preserve an existing schema12 database

Only schema12 with the identical rules identity greece-118-v31 can
migrate to schema13. Never migrate a database with different gameplay rules;
preserve older rules, saves, replays, account/profiles and receipts as archives.
The normal service refuses an unapproved schema12 database rather than silently
altering it. Stop its writer and preserve the source database and SQLite sidecars;
use the explicit migration to a fresh destination basename, never the source path:

```sh
node server/migrate-accounts.ts \
  --source /private/archive/game-greece-118-v31-schema12.sqlite \
  --destination /private/durable/game-greece-118-v31-schema13.sqlite
```

The migration reads the source, checks identity/integrity, preserves its existing
tables/data and adds account tables to the new schema13 copy. It refuses an
existing destination or SQLite sidecar. Inspect the result and keep the original
archive before repointing the service to the new path. No other rules identity
or in-place migration is implied. Backups contain private credential hashes and
game/account data; retain them outside public assets with private permissions.
