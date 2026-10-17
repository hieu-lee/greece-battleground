import { crossOriginApi } from "./urls.ts";
import { apiFetch, accountToken, identityChanged } from "./api.ts";
import { z } from "zod";

const guestReply = z
  .object({ guest: z.object({ id: z.uuid(), name: z.string() }).strict() })
  .strict();
const secretReply = z
  .object({ secret: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const code = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/);

export function accountRecovery(onRecovered: () => void) {
  const section = document.createElement("section");
  section.className = "account-recovery";
  if (crossOriginApi) {
    section.textContent =
      "Guest recovery is available only on the service's own website. Open that site to restore your guest, then protect it with a username and password. Use Account here to sign in.";
    return section;
  }
  if (accountToken()) {
    section.textContent =
      "This guest is protected by your account password. Use Account to sign in on another device.";
    return section;
  }
  section.innerHTML = `<p>Your recovery code restores your online guest, current polis and profile. It does not restore local Freeplay saves. Keep it private: anyone with it can take over your guest session.</p>
<section id="recovery-issue"><h3>Protect this guest</h3><p id="issue-status" role="status" tabindex="-1">Checking this browser's guest…</p></section>
<section><h3>Restore a guest</h3><form id="recover-form" autocomplete="off">
<label>Saved recovery code<input id="recover-secret" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" required></label>
<label class="recovery-confirm"><input id="recover-confirm" type="checkbox" required>Replace this browser's online session with the recovered guest. This does not delete the guest currently open here.</label>
<button id="recover-submit" type="submit">Restore guest</button></form>
<p id="recovery-status" role="status" tabindex="-1"></p></section>`;
  const issue = section.querySelector("#recovery-issue");
  const issueStatus = section.querySelector("#issue-status");
  const form = section.querySelector("#recover-form");
  const input = section.querySelector("#recover-secret");
  const submit = section.querySelector("#recover-submit");
  const status = section.querySelector("#recovery-status");
  if (
    !(issue instanceof HTMLElement) ||
    !(issueStatus instanceof HTMLElement) ||
    !(form instanceof HTMLFormElement) ||
    !(input instanceof HTMLInputElement) ||
    !(submit instanceof HTMLButtonElement) ||
    !(status instanceof HTMLElement)
  )
    throw new Error("Missing account recovery controls");

  submit.disabled = true;
  const initialize = async () => {
    try {
      const session = await apiFetch("/api/account/session");
      if (!section.isConnected) return;
      if (session.ok) {
        section.textContent =
          "This guest is protected by your account password. Use Account to sign in on another device.";
        return;
      }
      if (session.status !== 401) throw new Error("Account check unavailable");
      submit.disabled = false;
      const response = await apiFetch("/api/guest", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(10_000),
      });
      if (!section.isConnected) return;
      if (response.status === 401) {
        issueStatus.textContent =
          "No online guest is open here. Restore a saved guest below, or start async play to create one.";
        return;
      }
      if (!response.ok) throw new Error("service");
      const { guest } = guestReply.parse(await response.json());
      if (!section.isConnected) return;
      issueStatus.textContent = `Create or replace the recovery code for ${guest.name}. Any earlier code stops working immediately, even if you do not save the new one. A code stays valid until replaced or used.`;
      const button = document.createElement("button");
      button.id = "issue-recovery";
      button.type = "button";
      button.textContent = "Create / replace recovery code";
      const output = document.createElement("div");
      issue.append(button, output);
      button.addEventListener("click", async () => {
        issueStatus.textContent = "Creating a new recovery code…";
        if (document.activeElement === button) issueStatus.focus();
        button.disabled = true;
        output.replaceChildren();
        try {
          const reply = await apiFetch("/api/account/recovery", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestId: guest.id }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!section.isConnected) return;
          if (!reply.ok) {
            issueStatus.textContent =
              reply.status === 401 || reply.status === 409
                ? "Your browser guest changed. Close and reopen Account recovery before creating a code."
                : "The new code could not be shown. An earlier code may have been replaced. When the service is available, create and save another code.";
            return;
          }
          const generated = secretReply.parse(await reply.json());
          if (!section.isConnected) return;
          const label = document.createElement("label");
          label.textContent =
            "New recovery code — save it privately before closing";
          const value = document.createElement("textarea");
          value.id = "recovery-secret";
          value.readOnly = true;
          value.rows = 3;
          value.autocomplete = "off";
          value.spellcheck = false;
          value.value = generated.secret;
          label.append(value);
          const select = document.createElement("button");
          select.type = "button";
          select.id = "select-recovery";
          select.textContent = "Select code to copy";
          select.addEventListener("click", () => {
            value.focus();
            value.select();
          });
          output.append(label, select);
          issueStatus.textContent = `New code created for ${guest.name}. Save it in a private password manager or another safe place. It is not saved in browser storage and cannot be shown again. Using it once revokes the old browser session; create a replacement after recovery.`;
        } catch {
          if (section.isConnected)
            issueStatus.textContent =
              "The new code could not be shown. An earlier code may have been replaced. Check your connection, then create and save another code.";
        } finally {
          if (section.isConnected) button.disabled = false;
        }
      });
    } catch {
      if (section.isConnected)
        issueStatus.textContent =
          "The account service is unavailable. Close this panel and try again when connected.";
    }
  };
  // Mounting is synchronous; begin the guest request after the caller attaches this section.
  queueMicrotask(() => {
    void initialize();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = code.safeParse(input.value);
    input.value = "";
    if (!parsed.success) {
      status.textContent = "Enter the complete 64-character recovery code.";
      return;
    }
    if (!navigator.locks) {
      status.textContent =
        "This browser needs Web Locks for safe account recovery. Use a supported browser over HTTPS.";
      return;
    }
    status.textContent = "Restoring your guest…";
    if (form.contains(document.activeElement)) status.focus();
    submit.disabled = true;
    try {
      const response = await navigator.locks.request(
        "greece.async.identity",
        () =>
          section.isConnected
            ? apiFetch("/api/account/recover", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ secret: parsed.data }),
                signal: AbortSignal.timeout(10_000),
              })
            : null,
      );
      if (!response || !section.isConnected) return;
      if (!response.ok) {
        status.textContent =
          response.status === 429
            ? "Too many recovery attempts. Wait 15 minutes before trying again."
            : response.status === 401
              ? "This code is invalid, replaced or already used. Check your saved code."
              : "Recovery could not be confirmed. Check your connection and profile before retrying; the code may already have been used.";
        return;
      }
      guestReply.parse(await response.json());
      identityChanged();
      if (!section.isConnected) return;
      form.remove();
      issue.replaceChildren();
      status.textContent =
        "Your guest has been restored. Your old session and this code no longer work. Open your profile to create and save a replacement recovery code.";
      onRecovered();
    } catch {
      if (section.isConnected)
        status.textContent =
          "Recovery could not be confirmed. Check your connection and profile before retrying; the code may already have been used.";
    } finally {
      if (section.isConnected) submit.disabled = false;
    }
  });
  return section;
}
