import { realpathSync, statSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
};

export function staticFiles(directory: string) {
  const root = realpathSync(directory);
  if (!statSync(resolve(root, "index.html")).isFile())
    throw new Error("Assets must contain a built index.html");
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) => {
    const fail = (status: number) => {
      response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : "File unavailable");
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      fail(405);
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      fail(400);
      return;
    }
    if (
      pathname.includes("\\") ||
      pathname.includes("\0") ||
      pathname.split("/").some((part) => part.startsWith("."))
    ) {
      fail(404);
      return;
    }
    try {
      const file = await realpath(
        resolve(root, "." + (pathname === "/" ? "/index.html" : pathname)),
      );
      if (
        !file.startsWith(root + sep) ||
        file
          .slice(root.length + 1)
          .split(sep)
          .some((part) => part.startsWith("."))
      ) {
        fail(404);
        return;
      }
      const handle = await open(file, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile()) {
          fail(404);
          return;
        }
        response.writeHead(200, {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Content-Length": info.size,
          "Cache-Control": "no-cache",
        });
        if (request.method === "HEAD") response.end();
        else
          await pipeline(
            handle.createReadStream({ autoClose: false }),
            response,
          );
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (response.headersSent) response.destroy();
      else
        fail(
          error instanceof Error &&
            "code" in error &&
            ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code))
            ? 404
            : 500,
        );
    }
  };
}
