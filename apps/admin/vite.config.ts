import { fileURLToPath, URL } from "node:url"

import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 43129,
  },
  build: {
    outDir: "../../dist/admin",
    emptyOutDir: true,
  },
})
