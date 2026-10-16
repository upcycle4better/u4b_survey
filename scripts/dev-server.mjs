import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import healthHandler from "../api/health.mjs";

const root = resolve("public");
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function responseAdapter(response) {
  response.status = status => {
    response.statusCode = status;
    return response;
  };
  response.json = body => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  };
  return response;
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const path = resolve(root, `.${requested}`);
  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Not a file");
    const data = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

const server = createServer(async (request, rawResponse) => {
  const response = responseAdapter(rawResponse);
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/health") return healthHandler(request, response);
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Local development server error." }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`U4B Survey Intelligence running at http://127.0.0.1:${port}`);
});
