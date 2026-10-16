import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Electron dosyayı file:// ile yüklediği için göreli yollar gerekir.
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    // Geliştirmede API ile aynı kökenden çalışmak için (CORS gerekmez).
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true, ws: true } },
  },
});
