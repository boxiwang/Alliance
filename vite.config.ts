import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Dev-only: the app POSTs its real connected state + reads here so we can inspect the
// ACTUAL local connect→read→analyze pipeline (not an independent chain query).
function devReport() {
  return {
    name: "dev-report",
    configureServer(server: any) {
      server.middlewares.use("/__report", (req: any, res: any) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        let body = "";
        req.on("data", (c: any) => (body += c));
        req.on("end", () => {
          try {
            fs.writeFileSync("/tmp/ruglands-report.json", body);
          } catch {}
          console.log(`[report] ${body.length} bytes @ ${new Date().toISOString()}`);
          res.setHeader("access-control-allow-origin", "*");
          res.statusCode = 200;
          res.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devReport()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/bs": {
        target: "https://robinhoodchain.blockscout.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/bs/, ""),
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      },
    },
  },
});
