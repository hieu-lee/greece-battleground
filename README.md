# Greece Battleground

Greek mythology browser autobattler under active development. This clean game
snapshot contains runtime source and assets, not private original-game binaries,
captures, research archives or their Git history. Remaining source-rule and
presentation work means this is not a release-readiness claim.

Use Node24+ and pnpm11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm dev --port 5210
# Open http://127.0.0.1:5210/
pnpm build
pnpm verify
```

Freeplay works locally. Online play requires a separately hosted API; see
[operator instructions](docs/SELF-HOSTING.md). This snapshot does not configure
the public API hostname or deploy anything by itself. The prepared
[GitHub Pages workflow](docs/GITHUB-PAGES.md) publishes a development preview only.
[Username/password accounts](docs/ACCOUNTS.md) preserve the online guest and profile.

Rules: greece-118-v31. Save version: 31.
Database schema: 13.

`pnpm verify` runs runtime tests, exported-asset integrity, server types and
the client build. Private source-regeneration checks are outside this export.
`public-export.json` records the reviewed source commit, exact retained
file inventory and exclusions. It is provenance, not publication clearance or
an authentication secret.

See [third-party notices](THIRD-PARTY-NOTICES.md). No blanket new license is
granted to third-party clips or assets by this export.
