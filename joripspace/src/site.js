// 방문자 화면 쪽 서버 기능 (design-admin.md 8·9장, 11/25 수정본: 음식 파일 전용)
// - /: DB의 발행된 음식 파일을 index.html 안에 끼워서 보냄 (선택 A). HTML은 캐시하지 않음.
// - /images/번호: 올린 이미지. 발행된 음식 파일의 이미지만 방문자에게 보임 (관리자는 전부)
// - /api/receipts: 영수증 저장 (Render 대신)
// - /jobs/purge-trash: 하루 한 번 예약 작업이 부름. 30일 지난 휴지통·1년 지난 영수증 비우기
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import indexHtml from "../../index.html";
import { toFood, sortFoods, purgeContent, DAY, TRASH_DAYS } from "./content.js";
import { receipt as checkReceipt, InputError, IMG_RE } from "./validate.js";
import { currentSession, sameOrigin } from "./auth.js";

const RECEIPT_DAYS = 365; // 영수증 보관 기간 (11/25 사용자 결정: 1년)

// /admin/preview 처럼 한 단계 안쪽 주소에서도 폰트·아이콘이 깨지지 않게 상대 주소를 / 기준으로 바꿔 둠
const BASE_HTML = indexHtml
  .replace(/href="(fonts\/|icon5-|manifest\.webmanifest)/g, 'href="/$1')
  .replace(/url\(fonts\//g, "url(/fonts/");

export const site = new Hono();

// <script type="application/json"> 안에 넣어도 안전하게 (</script> 같은 글자가 태그로 안 읽히게)
const safeJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// 발행된 음식 파일 목록 (휴지통·임시저장은 절대 안 나감)
async function loadPublished(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM contents WHERE type = 'food' AND status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC"
  ).all();
  return { foods: sortFoods(results.map(toFood)) };
}

// 페이지 만들기: data를 </head> 바로 앞에 끼워 넣음. 사이트 스크립트가 #mz-data를 읽어 화면을 그림
// noindex=true면 검색엔진에 안 나오게 (관리자 미리보기)
function page(c, data, { noindex = false, cache = "no-cache" } = {}) {
  let html = BASE_HTML;
  if (noindex) html = html.replace("</head>", () => '<meta name="robots" content="noindex">\n</head>');
  const dataTag = `<script id="mz-data" type="application/json">${safeJson(data)}</script>\n</head>`;
  html = html.replace("</head>", () => dataTag); // 함수 방식: 내용에 $& 같은 글자가 있어도 그대로 들어감
  return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache });
}

// 관리자 미리보기 칸: 사이트 화면 그대로 + route "preview". 편집 화면이 postMessage로 지금 입력한 내용을 보내면
// 사이트 스크립트가 그 내용으로 화면을 그림. 관리자 로그인 확인은 admin-pages.js에서 함
export async function previewPage(c) {
  let data;
  try {
    data = await loadPublished(c.env);
  } catch (e) {
    data = { error: true, foods: [] };
  }
  return page(c, { ...data, route: "preview" }, { noindex: true, cache: "private, no-store" });
}

// 첫 화면: DB를 못 읽어도 페이지는 보냄 (음식 폴더 자리에 안내, 게시판 등은 그대로)
async function home(c) {
  try {
    return page(c, await loadPublished(c.env));
  } catch (e) {
    console.error("load_published_failed");
    return page(c, { error: true, foods: [] });
  }
}
site.get("/", home);
site.get("/index.html", home);

// 이미지: 방문자는 '발행된 음식 파일에 쓰인 이미지'만 볼 수 있음. 관리자(로그인)는 미리보기용으로 전부
site.get("/images/:id", async (c) => {
  const env = c.env, id = c.req.param("id");
  if (!IMG_RE.test(id)) return c.text("Not found", 404);
  const img = await env.DB.prepare("SELECT id, mime FROM images WHERE id = ?").bind(id).first();
  if (!img) return c.text("Not found", 404);
  const isPublic = await env.DB.prepare(
    "SELECT 1 FROM contents WHERE status = 'published' AND deleted_at IS NULL AND (cover LIKE ? OR data LIKE ?) LIMIT 1"
  )
    .bind(`%"${id}"%`, `%img:${id}%`)
    .first();
  const admin = !isPublic && (await currentSession(c));
  if (!isPublic && !admin) return c.text("Not found", 404);
  const obj = await env.STORAGE.get("images/" + id);
  if (!obj) return c.text("Not found", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": isPublic ? "public, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// 영수증 저장: 같은 브라우저 번호면 덮어씀. 이름·서명은 받지 않음
site.post("/api/receipts", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) }), async (c) => {
  if (!sameOrigin(c)) return c.json({ error: "origin_not_allowed" }, 403); // 우리 사이트 화면에서 보낸 것만 받음
  let input;
  try {
    input = await c.req.json();
  } catch (e) {
    return c.json({ error: "invalid" }, 400);
  }
  let r;
  try {
    r = checkReceipt(input);
  } catch (e) {
    if (e instanceof InputError) return c.json({ error: "invalid", field: e.field }, 400);
    throw e;
  }
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO receipts (client_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  )
    .bind(r.clientId, JSON.stringify(r.data), now, now)
    .run();
  return c.json({ ok: true });
});

// 하루 한 번 예약 작업: 30일 지난 휴지통 항목 영구 삭제 + 1년 지난 영수증 + 만료된 로그인·오래된 실패 기록 정리
// 조립스페이스 예약 작업만 부를 수 있음 (밖에서 부르면 403). 여러 번 돌아도 결과가 같음
async function purgeTrash(c) {
  if (new URL(c.req.url).hostname !== "joripspace-cron.internal") return c.json({ error: "scheduler_required" }, 403);
  const env = c.env, now = Date.now();
  const { results } = await env.DB.prepare("SELECT id FROM contents WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY deleted_at LIMIT 50")
    .bind(now - TRASH_DAYS * DAY)
    .all();
  let purged = 0;
  for (const r of results) if (await purgeContent(env, r.id)) purged++;
  // 저장도 안 하고 버려진 이미지(어느 콘텐츠에도 연결 안 됨, 하루 지남)
  const { results: orphans } = await env.DB.prepare("SELECT id FROM images WHERE content_id IS NULL AND created_at <= ? LIMIT 50").bind(now - DAY).all();
  for (const o of orphans) {
    await env.STORAGE.delete("images/" + o.id);
    await env.DB.prepare("DELETE FROM images WHERE id = ? AND content_id IS NULL").bind(o.id).run();
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM receipts WHERE updated_at <= ?").bind(now - RECEIPT_DAYS * DAY), // 마지막으로 고친 지 1년 지난 영수증
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM login_failures WHERE at <= ?").bind(now - DAY),
  ]);
  return c.json({ ok: true, purged, orphans: orphans.length, more: results.length === 50 });
}
site.post("/jobs/purge-trash", purgeTrash);
site.get("/jobs/purge-trash", purgeTrash);
