import { resolve } from "node:path";
import { defineConfig } from "vite";

const proxy = { "/api": "http://127.0.0.1:5396" };
export default defineConfig({
  server: { proxy },
  preview: { proxy },
  input: {
    game: resolve(import.meta.dirname, "index.html"),
    workshop: resolve(import.meta.dirname, "workshop.html"),
    art: resolve(import.meta.dirname, "art-review.html"),
    clans: resolve(import.meta.dirname, "clans.html"),
    play: resolve(import.meta.dirname, "play.html"),
    effects: resolve(import.meta.dirname, "effects.html"),
  },
});
