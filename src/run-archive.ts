import { exportRunArchive, readRun, runKey } from "./run-storage.ts";
import type { RunMode } from "./run-storage.ts";
import "./run-archive.css";

export function appendRunArchives(container: HTMLElement, mode: RunMode) {
  const saved = readRun(mode);
  const keys = saved.archives.map((archive) => archive.key);
  if (saved.issue) keys.push(runKey(mode));
  for (const key of keys) {
    const archive = exportRunArchive(mode, key);
    if (!archive) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "run-archive-button";
    button.dataset.archive = key;
    const version = key.slice(key.lastIndexOf(".v") + 2);
    button.textContent =
      key === runKey(mode)
        ? `Download incompatible v${version} save`
        : `Download previous-rules v${version} save`;
    button.addEventListener("click", () => {
      const url = URL.createObjectURL(
        new Blob([archive.content], { type: archive.type }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = archive.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    container.append(button);
  }
}
