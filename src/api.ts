import { apiOrigin, apiUrl } from "./urls.ts";
const tokenKey = "greece-battleground.account.session." + apiOrigin;
const identityKey = "greece-battleground.account.identity." + apiOrigin;
const listeners = new Set<(external: boolean) => void>();
export function accountToken() {
  const token = localStorage.getItem(tokenKey);
  return token !== null && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function identityChanged() {
  localStorage.setItem(identityKey, crypto.randomUUID());
  for (const listener of listeners) listener(false);
}
export function saveAccountToken(token: string | null) {
  if (token !== null && !/^[a-f0-9]{64}$/.test(token))
    throw new Error("Invalid account session.");
  if (token) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
  identityChanged();
}
export function onAccountChange(
  listener: (external: boolean) => void,
  signal?: AbortSignal,
) {
  listeners.add(listener);
  signal?.addEventListener("abort", () => listeners.delete(listener), {
    once: true,
  });
  return () => listeners.delete(listener);
}
if (typeof addEventListener === "function")
  addEventListener("storage", (event) => {
    if (
      event.key === tokenKey ||
      event.key === identityKey ||
      event.key === null
    )
      for (const listener of listeners) listener(true);
  });
export function withIdentityLock<T>(action: () => Promise<T>) {
  if (!navigator.locks)
    throw new Error("This browser needs Web Locks for safe account changes.");
  return navigator.locks.request("greece.async.identity", action);
}
export async function apiFetch(path: string, init: RequestInit = {}) {
  const url = apiUrl(path);
  const token = accountToken();
  const headers = new Headers(init.headers);
  headers.delete("Authorization");
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
    signal: init.signal ?? AbortSignal.timeout(10000),
  });
  if (accountToken() !== token)
    throw new Error("Account changed. Return to the menu.");
  return response;
}
