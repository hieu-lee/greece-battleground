# GitHub Pages development preview

This workflow publishes a development preview, not a release-readiness claim.
Only the clean public export may be published; keep the original research
repository, source binaries/captures, archives, databases and private history private.

1. In the clean repository's Settings > Pages, set Source to GitHub Actions.
2. In Settings > Secrets and variables > Actions > Variables, set repository
   variable VITE_API_ORIGIN to the reachable HTTPS API origin, for example
   https://api.example.com. Use only scheme and host/optional port, without a
   path, credentials, query or fragment. This is public client configuration,
   not a password or secret; Vite embeds it into the client build.
3. Permit only main in the github-pages deployment environment. Push reviewed
   work to main, or run the Pages workflow manually on main. The workflow checks
   the API setting, required base/API modules, runtime tests/assets, server types
   and the client build before uploading only dist and deploying that artifact.
   Verify covers pull requests and non-main pushes without duplicating main checks.

The project build command is:

```sh
VITE_API_ORIGIN=https://api.example.com pnpm build --base=/greece-battleground/
```

The default public address is https://hieu-lee.github.io/greece-battleground/.
If the public repository name changes, update the workflow's base and these
navigation assumptions together. A custom domain/root site needs its own matching
base. The API origin is independent of the client asset/navigation base.

Run the Node API on this machine behind HTTPS, with a private versioned database
and the matching reviewed server/source/dependencies. Configure the exact Pages
origin on the service: --origin https://hieu-lee.github.io (no project path).
For a separately served same-origin client as well, account-capable versions allow
another --origin for that HTTPS origin; use --secure-cookie for HTTPS cookies.
Keep the Node port loopback-only and preserve other machine services.

Account-capable clients send an origin-scoped bearer session in Authorization,
so cross-site login does not depend on third-party cookies. The API must allow
the exact frontend origin and Authorization preflight; never substitute wildcard
CORS. Browser storage contains a session credential, not a password. Keep request
bodies, authorization/cookie headers and account responses out of logs/evidence.

Old pinned exports without src/urls.ts and src/api.ts fail the Pages runtime
support check; exporting them does not make their root-only paths or guest-cookie
transport ready for Pages. Select a reviewed base/API-capable commit instead.
The HTTPS configuration check is local syntax validation, not DNS/TLS/service
reachability. After deployment, verify actual asset loads, API health, sign-up,
login/logout, persisted progress and reconnect from the public address. A build
or generated workflow alone does not prove any of those outcomes.

GitHub's current setup and permission requirements:
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
