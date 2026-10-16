// Mobil web derlemesini ve API proxy'sini aynı kökenden sunar (API'de CORS yoktur).
// REST istekleri ve WebSocket yükseltmeleri (/api/...) API'ye iletilir.
// Kullanım: node e2e/serve-web.mjs <derleme klasörü> <port> <api port>
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const [dist, port = "8081", apiPort = "3000"] = process.argv.slice(2);
const root = path.resolve(dist);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".css": "text/css" };

const server = http.createServer((req, res) => {
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
});

// WebSocket: yükseltme isteğini olduğu gibi API'ye aktarır, sonra iki yönlü boru kurar.
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/api/")) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(Number(apiPort), "127.0.0.1", () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(Number(port), "127.0.0.1", () => console.log(`web: http://127.0.0.1:${port} -> api: ${apiPort}`));
