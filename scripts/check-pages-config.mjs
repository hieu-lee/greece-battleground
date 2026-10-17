const input = process.env.VITE_API_ORIGIN;
let valid = false;
try {
  const url = new URL(input ?? '');
  valid = Boolean(input) && url.protocol === 'https:' && !url.username &&
    !url.password && url.pathname === '/' && !url.search && !url.hash;
} catch {}
if (!valid) {
  process.stderr.write('VITE_API_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.\n');
  process.exitCode = 1;
} else console.log('HTTPS API origin configuration accepted; reachability is not verified.');
