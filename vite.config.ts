import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// 단일 Worker + static assets (CLAUDE.md §2/§8).
// `vite dev`는 workerd로 Worker(/api/resolve)와 FE를 동일 origin에서 띄우고,
// `vite build`는 dist/client(assets) + Worker 번들을 산출한다.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
