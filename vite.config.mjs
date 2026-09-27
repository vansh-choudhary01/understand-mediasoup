import { defineConfig } from "vite";

export default defineConfig({
  // Keep the existing public/index.html and public/client.js layout,
  // but let Vite process the npm imports in client.js.
  root: "public",
  publicDir: false,
});
