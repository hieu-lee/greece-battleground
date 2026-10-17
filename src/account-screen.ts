import { z } from "zod";
import {
  accountAuthorization,
  accountLogin,
  accountSession,
  accountSignup,
} from "./accounts.ts";
import {
  apiFetch,
  accountToken,
  saveAccountToken,
  withIdentityLock,
} from "./api.ts";
import { appUrl } from "./urls.ts";
import { preferences } from "./preferences.ts";
import { selectedClan } from "./clans.ts";
const guestReply = z.object({
  guest: z.object({ id: z.uuid(), name: z.string() }),
});
export function accountScreen(onChanged: () => void) {
  const section = document.createElement("section");
  section.className = "account-screen";
  const status = document.createElement("p");
  status.id = "account-status";
  status.role = "status";
  status.tabIndex = -1;
  status.textContent = "Checking your account…";
  section.append(status);
  let mode: "login" | "signup" = "login";
  let guest: z.infer<typeof guestReply>["guest"] | null = null;
  let busy = false;
  function form() {
    section.replaceChildren(status);
    const intro = document.createElement("p");
    intro.textContent = guest
      ? `Create an account to keep ${guest.name} and this exact online polis. Signing in restores the account's own polis.`
      : "Sign in to resume your online polis on this device, or create an account. Local Freeplay and Tutorial saves stay on this device.";
    const tabs = document.createElement("div");
    tabs.className = "account-tabs";
    for (const [value, label] of [
      ["login", "Sign in"],
      ["signup", "Create account"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "account-" + value;
      button.textContent = label;
      button.setAttribute("aria-pressed", String(mode === value));
      button.onclick = () => {
        if (busy) return;
        mode = value;
        form();
        section.querySelector<HTMLInputElement>("#account-username")?.focus();
      };
      tabs.append(button);
    }
    const fields = document.createElement("form");
    fields.id = "account-form";
    fields.innerHTML = `<label>Username<input id="account-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" required></label><label>Password<input id="account-password" name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" minlength="15" maxlength="128" required></label><p class="account-help">${mode === "signup" ? "Use 3–32 letters, numbers or underscores and a password of 15–128 characters. " + (guest ? "Your existing guest and progress will be kept." : "Creates a new unranked polis with your selected clan and local player name.") : "Your saved account includes its online guest, current run and profile."}</p><button type="submit" id="account-submit">${mode === "signup" ? (guest ? "Protect this guest" : "Create account") : "Sign in"}</button>`;
    fields.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const username =
        fields.querySelector<HTMLInputElement>("#account-username")!;
      const password =
        fields.querySelector<HTMLInputElement>("#account-password")!;
      const input = { username: username.value, password: password.value };
      const parsed =
        mode === "signup"
          ? accountSignup.safeParse({
              ...input,
              ...(guest
                ? { guestId: guest.id }
                : {
                    guest: { name: preferences().name, clan: selectedClan() },
                  }),
            })
          : accountLogin.safeParse(input);
      if (!parsed.success) {
        status.textContent = "Check your username and password lengths.";
        status.focus();
        return;
      }
      busy = true;
      section.setAttribute("aria-busy", "true");
      for (const control of section.querySelectorAll("button,input"))
        if (
          control instanceof HTMLButtonElement ||
          control instanceof HTMLInputElement
        )
          control.disabled = true;
      status.textContent =
        mode === "signup" ? "Creating your account…" : "Signing in…";
      status.focus();
      try {
        await withIdentityLock(async () => {
          if (!section.isConnected) return;
          const response = await apiFetch(
            "/api/account/" + (mode === "signup" ? "signup" : "login"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(parsed.data),
            },
          );
          password.value = "";
          if (!response.ok) {
            const error = z
              .object({ error: z.string() })
              .parse(await response.json());
            throw new Error(
              error.error === "invalid-credentials"
                ? "Username or password is incorrect."
                : error.error === "username-unavailable"
                  ? "That username is already in use."
                  : response.status === 429
                    ? "Too many attempts. Wait 15 minutes before trying again."
                    : response.status === 503
                      ? "Sign-in is busy. Try again shortly."
                      : error.error === "guest-changed"
                        ? "Your guest changed. Close and reopen Account."
                        : "Account request failed. Check your connection and try again.",
            );
          }
          const result = accountAuthorization.parse(await response.json());
          saveAccountToken(result.session.token);
          if (section.isConnected)
            signedIn(result.account.username, result.session.token);
          onChanged();
        });
      } catch (error) {
        if (section.isConnected) {
          status.textContent =
            error instanceof Error
              ? error.message
              : "Account service unavailable.";
          status.focus();
        }
      } finally {
        password.value = "";
        busy = false;
        section.removeAttribute("aria-busy");
        for (const control of section.querySelectorAll("button,input"))
          if (
            control instanceof HTMLButtonElement ||
            control instanceof HTMLInputElement
          )
            control.disabled = false;
      }
    };
    section.append(intro, tabs, fields);
  }
  function signedIn(username: string, sessionToken: string | null) {
    section.replaceChildren(status);
    status.textContent = `Signed in as ${username}.`;
    const note = document.createElement("p");
    note.textContent =
      "Your online guest, polis and profile follow this account. Signing out affects this device only.";
    const resume = document.createElement("a");
    resume.className = "menu-link";
    resume.id = "account-resume";
    resume.href = appUrl("/play.html?mode=async");
    resume.textContent = "Resume your online polis";
    const logout = document.createElement("button");
    logout.type = "button";
    logout.id = "account-logout";
    logout.textContent = "Sign out";
    logout.onclick = async () => {
      if (busy) return;
      busy = true;
      logout.disabled = true;
      status.textContent = "Signing out…";
      try {
        await withIdentityLock(async () => {
          if (!section.isConnected || accountToken() !== sessionToken) return;
          const response = await apiFetch("/api/account/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (!response.ok)
            throw new Error("Sign-out could not be confirmed. Try again.");
          saveAccountToken(null);
          guest = null;
          status.textContent = "Signed out on this device.";
          if (section.isConnected) form();
          onChanged();
        });
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "Sign-out unavailable.";
      } finally {
        busy = false;
        logout.disabled = false;
        status.focus();
      }
    };
    section.append(note, resume, logout);
  }
  queueMicrotask(async () => {
    try {
      const sessionToken = accountToken();
      const session = await apiFetch("/api/account/session");
      if (!section.isConnected || accountToken() !== sessionToken) return;
      if (session.ok) {
        const parsed = accountSession.parse(await session.json());
        if (!section.isConnected || accountToken() !== sessionToken) return;
        signedIn(parsed.account.username, sessionToken);
        return;
      }
      if (session.status !== 401)
        throw new Error(
          "Account service unavailable. Close and reopen to retry.",
        );
      const response = await apiFetch("/api/guest");
      if (response.ok) guest = guestReply.parse(await response.json()).guest;
      if (!section.isConnected) return;
      status.textContent = "Sign in or protect your guest.";
      form();
    } catch (error) {
      if (section.isConnected)
        status.textContent =
          error instanceof Error
            ? error.message
            : "Account service unavailable. Close and reopen to retry.";
    }
  });
  return section;
}
