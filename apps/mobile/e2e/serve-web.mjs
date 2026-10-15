// Mobil web derlemesini ve API proxy'sini aynı kökenden sunar (API'de CORS yoktur).
// Kullanım: node e2e/serve-web.mjs <derleme klasörü> <port> <api port>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const [dist, port = "8081", apiPort = "3000"] = process.argv.slice(2);
const root = path.resolve(dist);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".css": "text/css" };

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const upstream = http.request({ host: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers: req.headers }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      });
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const rel = decodeURIComponent(req.url.split("?")[0]);
    let file = path.resolve(root, "." + (rel === "/" ? "/index.html" : rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(port), "127.0.0.1", () => console.log(`web: http://127.0.0.1:${port} -> api: ${apiPort}`));
