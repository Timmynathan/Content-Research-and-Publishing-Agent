import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Vite serves the front end; `vercel dev` serves the api/ functions on
    // 3000. Letting `vercel dev` serve both breaks Vite's module requests
    // (/src/main.tsx, /@react-refresh 404), so we proxy instead.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
