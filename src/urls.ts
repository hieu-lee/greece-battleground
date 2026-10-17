const configured = import.meta.env?.VITE_API_ORIGIN;
const configuredUrl = configured ? new URL(configured) : null;
if (
  configuredUrl &&
  (!["http:", "https:"].includes(configuredUrl.protocol) ||
    configuredUrl.username ||
    configuredUrl.password ||
    configuredUrl.pathname !== "/" ||
    configuredUrl.search ||
    configuredUrl.hash)
)
  throw new Error("VITE_API_ORIGIN must be an absolute HTTP(S) origin.");
export const apiOrigin =
  configuredUrl?.origin ??
  (typeof location === "undefined" ? "" : location.origin);
export const crossOriginApi =
  typeof location !== "undefined" && apiOrigin !== location.origin;
export function appUrl(path = "/") {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Use an app-relative path.");
  return (import.meta.env?.BASE_URL ?? "/") + path.slice(1);
}
export function apiUrl(path: string) {
  if (
    !path.startsWith("/api/") ||
    new URL(path, "http://api.invalid").pathname.startsWith("/api/") === false
  )
    throw new Error("Use an API-relative path.");
  return configuredUrl ? configuredUrl.origin + path : path;
}
