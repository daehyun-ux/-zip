// 먹어봤.zip — 조립스페이스 서버 (Hono)
// 사이트 파일(index.html, 폰트, 아이콘, manifest, og.png)을 서버 번들 안에 넣어 그대로 응답한다.
// 화면 수정은 index.html에서 하고, `npm run build`로 다시 묶는다.
// 새 파일(이미지 등)을 사이트에 추가하면 아래 import와 files 목록에도 한 줄씩 추가해야 한다.
// 관리자 기능(design-admin.md): 로그인은 auth.js, 관리자 API는 admin-api.js, 방문자 화면·영수증·휴지통 비우기는 site.js
import { Hono } from "hono";
import { mountAuth } from "./auth.js";
import { adminApi } from "./admin-api.js";
import { site } from "./site.js";
import { mountAdminPages } from "./admin-pages.js";
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

// 로그인·로그아웃 (/api/admin/login, /api/admin/logout, /api/admin/status)
mountAuth(app);
// 관리자 API: 로그인한 관리자만
app.route("/api/admin", adminApi);
// 관리자 화면 (/admin, /admin/login, /admin/new, /admin/edit/:id, /admin/trash, /admin/preview)
mountAdminPages(app);
// 방문자 화면(/), 이미지, 영수증, 예약 작업
app.route("/", site);

for (const [path, [body, type, cache]] of Object.entries(files)) {
  app.get(path, (c) => c.body(body, 200, { "Content-Type": type, "Cache-Control": cache }));
}

app.notFound((c) => c.text("Not found", 404));

// 예상 못 한 오류: 요청 내용·쿠키는 기록하지 않고 오류 번호만 남김
app.onError((err, c) => {
  const errorId = crypto.randomUUID();
  console.error("request_failed", errorId, err && err.name);
  if (c.req.path.startsWith("/api/")) return c.json({ error: "server_error", message: "저장 못 했어. 잠시 뒤 다시 해줘", errorId }, 500);
  return c.text("잠시 문제가 생겼어. 잠시 뒤 다시 열어줘", 500);
});

export default app;
