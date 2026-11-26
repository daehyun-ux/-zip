// 관리자 화면 주소 (design-admin.md 7장)
// /admin/login, /admin, /admin/new, /admin/edit/:id, /admin/trash → 모두 admin/admin.html 한 파일을 보내고, 화면은 그 안의 스크립트가 주소를 보고 그림.
// 로그인 안 했으면 로그인 화면으로 보냄(로그인하면 원래 가려던 화면으로). 검색엔진에는 안 나오게(noindex).
// /admin/preview: 편집 화면 오른쪽 미리보기 칸. 실제 사이트 화면을 그대로 쓰고, 관리자에게만 보임.
import adminHtml from "../../admin/admin.html";
import { currentSession } from "./auth.js";
import { previewPage } from "./site.js";
import indexHtml from "../../index.html";

// index.html의 <symbol id="…">…</symbol>만 모아 둠 (서버가 처음 뜰 때 한 번)
const ICONS_SVG = `<svg xmlns="http://www.w3.org/2000/svg">${(indexHtml.match(/<symbol id="[^"]+"[\s\S]*?<\/symbol>/g) || []).join("")}</svg>`;

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const sendAdmin = (c) => c.body(adminHtml, 200, headers);

// next는 /admin으로 시작하는 우리 사이트 주소만 (다른 사이트로 튕기기 막기)
const safeNext = (v) => (typeof v === "string" && /^\/admin(\/|\?|$)/.test(v) && !v.startsWith("/admin/login") ? v : "/admin");

export function mountAdminPages(app) {
  app.get("/admin/login", async (c) => {
    if (await currentSession(c)) return c.redirect(safeNext(c.req.query("next")), 302);
    return sendAdmin(c);
  });

  const gate = async (c) => {
    if (!(await currentSession(c))) {
      const u = new URL(c.req.url);
      return c.redirect("/admin/login?next=" + encodeURIComponent(u.pathname + u.search), 302);
    }
    return sendAdmin(c);
  };
  app.get("/admin", gate);
  app.get("/admin/", gate);
  app.get("/admin/trash", gate);
  app.get("/admin/new", gate);
  app.get("/admin/edit/:id{[a-z0-9-]{2,24}}", gate);

  // 음식 아이콘 그림: index.html 안의 <symbol>들만 모은 SVG 한 장 (관리자 목록·편집 화면에서 <use href="/admin/icons.svg#cookie">로 씀)
  app.get("/admin/icons.svg", async (c) => {
    if (!(await currentSession(c))) return c.text("Not found", 404);
    return c.body(ICONS_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" });
  });

  app.get("/admin/preview", async (c) => {
    if (!(await currentSession(c))) return c.text("Not found", 404);
    return previewPage(c);
  });
}
