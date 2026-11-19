import { defineConfig } from "vite";

// The client is a plain single-page app. In development `npm run dev` serves
// it alone (boards then run on this device only); `npm run dev:worker` builds
// it and serves it from the Worker with live boards. picture.html is the page
// a headless browser opens to draw the week for an AI (worker/picture.ts).
export default defineConfig({
  build: { outDir: "dist", target: "es2022", sourcemap: true, rollupOptions: { input: { main: "index.html", picture: "picture.html" } } },
  server: { port: 5173 },
});
