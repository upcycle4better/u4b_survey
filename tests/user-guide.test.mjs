import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const guideUrl = "https://drive.google.com/file/d/1REh7TaDQGVsdcjxqO4hINw5KqOEUEfUM/view?usp=sharing";
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("the interface exposes the user guide link and QR code", async () => {
  assert.match(html, new RegExp(`href="${guideUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, />\s*User Guide\s*</);
  assert.match(html, /src="\/assets\/u4b-user-guide-qr\.svg"/);
  await access(new URL("../public/assets/u4b-user-guide-qr.svg", import.meta.url));
});
