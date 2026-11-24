// 먹어봤.zip — 조립스페이스 서버 (Hono)
// 사이트 파일(index.html, 폰트, 아이콘, manifest, og.png)을 서버 번들 안에 넣어 그대로 응답한다.
// 화면 수정은 index.html에서 하고, `npm run build`로 다시 묶는다.
// 새 파일(이미지 등)을 사이트에 추가하면 아래 import와 files 목록에도 한 줄씩 추가해야 한다.
import { Hono } from "hono";
import indexHtml from "../../index.html";
import manifest from "../../manifest.webmanifest";
import og from "../../og.png";
import font400 from "../../fonts/meogeobom-400.woff2";
import font700 from "../../fonts/meogeobom-700.woff2";
import font800 from "../../fonts/meogeobom-800.woff2";
import fav32 from "../../icon5-favicon-32.png";
import apple180 from "../../icon5-apple-180.png";
import icon192 from "../../icon5-192.png";
import icon512 from "../../icon5-512.png";
import maskable512 from "../../icon5-maskable-512.png";

const app = new Hono();

const html = (c) =>
  c.body(indexHtml, 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });

const DAY = "public, max-age=86400";
const YEAR = "public, max-age=31536000, immutable";

// 주소 → [파일 내용, 파일 종류, 캐시 시간]
const files = {
  "/manifest.webmanifest": [manifest, "application/manifest+json; charset=utf-8", DAY],
  "/og.png": [og, "image/png", DAY],
  "/fonts/meogeobom-400.woff2": [font400, "font/woff2", YEAR],
  "/fonts/meogeobom-700.woff2": [font700, "font/woff2", YEAR],
  "/fonts/meogeobom-800.woff2": [font800, "font/woff2", YEAR],
  "/icon5-favicon-32.png": [fav32, "image/png", DAY],
  "/icon5-apple-180.png": [apple180, "image/png", DAY],
  "/icon5-192.png": [icon192, "image/png", DAY],
  "/icon5-512.png": [icon512, "image/png", DAY],
  "/icon5-maskable-512.png": [maskable512, "image/png", DAY],
};

app.get("/", html);
app.get("/index.html", html);

for (const [path, [body, type, cache]] of Object.entries(files)) {
  app.get(path, (c) => c.body(body, 200, { "Content-Type": type, "Cache-Control": cache }));
}

app.notFound((c) => c.text("Not found", 404));

export default app;
