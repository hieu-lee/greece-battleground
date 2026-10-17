import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { gameServer } from "./http.ts";

const { values } = parseArgs({
  options: {
    database: { type: "string" },
    assets: { type: "string" },
    port: { type: "string", default: "5196" },
    host: { type: "string", default: "127.0.0.1" },
    origin: { type: "string", multiple: true },
    "trust-loopback-proxy": { type: "boolean", default: false },
    "secure-cookie": { type: "boolean", default: false },
  },
});
const port = Number(values.port);
if (!values.database || !Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error(
    "Provide --database /durable/path/game.sqlite and --port 0..65535",
  );
const origins = values.origin?.map((value) => {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an exact HTTP(S) origin without credentials or a path",
    );
  return url.origin;
});
if (
  values["trust-loopback-proxy"] &&
  !["127.0.0.1", "::1", "localhost"].includes(values.host)
)
  throw new Error("Trusted proxy mode requires a loopback bind address");
const server = gameServer({
  database: resolve(values.database),
  ...(values.assets ? { assets: resolve(values.assets) } : {}),
  secureCookie: values["secure-cookie"],
  trustLoopbackProxy: values["trust-loopback-proxy"],
  ...(origins ? { allowedOrigin: origins } : {}),
});
server.listen(port, values.host, () => {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No HTTP address");
  process.stdout.write(
    JSON.stringify({
      ready: true,
      host: values.host,
      port: address.port,
      mode: "async",
      ranked: true,
    }) + "\n",
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
  });
