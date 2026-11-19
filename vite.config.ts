import { defineConfig } from "vite";

// The client is a plain single-page app. In development `npm run dev` serves
// it alone (boards then run on this device only); `npm run dev:worker` builds
// it and serves it from the Worker with live boards.
export default defineConfig({
  build: { outDir: "dist", target: "es2022", sourcemap: true },
  server: { port: 5173 },
});
