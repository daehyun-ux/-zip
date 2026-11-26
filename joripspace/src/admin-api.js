// 관리자 API (/api/admin/...). 모든 경로는 requireAdmin을 거친다 → 로그인 안 했으면 401, 데이터 없음.
// design-admin.md 7장 (11/25 수정본: 음식 파일 전용): 목록·쓰기·임시저장·발행·발행 취소·휴지통·되살리기·영구 삭제·이미지 올리기
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAdmin } from "./auth.js";
import { content as checkContent, InputError, ID_RE, aliasNorm } from "./validate.js";
import { toAdmin, imageIdsOf, purgeContent } from "./content.js";

export const adminApi = new Hono();
adminApi.use("*", requireAdmin);

const MAX_IMAGE = 2 * 1024 * 1024; // 줄인 뒤 2MB 이하 (5-3)
const fail = (c, status, error, message, extra = {}) => c.json({ error, message, ...extra }, status);

// 관리자 화면 주소용 무작위 번호 (사이트의 음식 번호는 고유 주소 slug를 씀)
function newId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const r = crypto.getRandomValues(new Uint8Array(9));
  return "f" + Array.from(r, (b) => abc[b % abc.length]).join("");
}
const newImageId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

async function readJson(c) {
  try {
    const v = await c.req.json();
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}

// 겹치지 않는 고유 주소 추천: slug-2, slug-3 …
async function suggestSlug(env, slug, exceptId) {
  const base = (slug || "food").replace(/-\d+$/, "").slice(0, 21).replace(/-+$/, "") || "food"; // 2~24자 안에 들어가게
  for (let i = 2; i < 100; i++) {
    const s = `${base}-${i}`;
    const hit = await env.DB.prepare("SELECT id FROM contents WHERE slug = ? AND id != ?").bind(s, exceptId || "").first();
    if (!hit) return s;
  }
  return null;
}
async function slugTaken(env, slug, exceptId) {
  if (!slug) return false;
  return !!(await env.DB.prepare("SELECT id FROM contents WHERE slug = ? AND id != ?").bind(slug, exceptId || "").first());
}

// 검사 오류 → 400 / 주소 겹침 → 409
async function guard(c, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InputError) return fail(c, 400, "invalid", e.message, { field: e.field, ...e.extra });
    if (/UNIQUE constraint failed: contents\.slug/.test(String(e && e.message))) {
      return fail(c, 409, "slug_taken", "이 주소는 이미 쓰고 있어", { field: "slug" });
    }
    throw e;
  }
}

// 발행 전: 이미지가 실제로 올라가 있는지
async function checkImagesExist(env, c) {
  for (const id of imageIdsOf(c)) {
    const hit = await env.DB.prepare("SELECT id FROM images WHERE id = ?").bind(id).first();
    if (!hit) throw new InputError(c.cover && c.cover.id === id ? "cover" : "data.icon", "이미지를 찾을 수 없어. 다시 올려줘");
  }
}

// 저장할 때 아직 주인 없는 이미지를 이 음식 파일에 연결 (영구 삭제 때 같이 정리하려고)
const claimImages = (env, id, c) =>
  imageIdsOf(c).map((img) => env.DB.prepare("UPDATE images SET content_id = ? WHERE id = ? AND content_id IS NULL").bind(id, img));

// 오답 보기: 새로 고른 것은 발행된 음식(휴지통 아님)만. 이미 들어 있던 것은 그대로 둠(기존 데이터 보호)
async function checkNewOpts(env, v, oldOpts) {
  const added = v.data.opts.filter((x) => x !== v.slug && !oldOpts.includes(x));
  if (!added.length) return;
  const { results } = await env.DB.prepare("SELECT slug FROM contents WHERE status = 'published' AND deleted_at IS NULL").all();
  const ok = new Set(results.map((r) => r.slug));
  const i = v.data.opts.findIndex((x) => added.includes(x) && !ok.has(x));
  if (i >= 0) throw new InputError(`data.opts.${i}`, "오답 보기는 발행된 음식 중에서만 고를 수 있어");
}

// 이름·별칭 겹침 (design-alias.md 5장·10장): 휴지통 아닌 다른 음식(발행 + 임시저장)의 이름·별칭과 같으면 막음.
// 별칭이 0개여도 이름은 항상 검사함 (새로 만들 때·이름을 바꿀 때 모두). 이 저장 요청 안에서 DB를 한 번만 읽음 (HTTP 요청 추가 없음)
const josa = (w) => { const k = w.charCodeAt(w.length - 1) - 0xac00; return k >= 0 && k < 11172 ? (k % 28 ? "은" : "는") : "은(는)"; };
async function checkNameConflict(env, v, exceptId, sentAlias) {
  const mine = v.data.alias || [];
  const { results } = await env.DB.prepare("SELECT id, slug, title, data FROM contents WHERE deleted_at IS NULL AND id != ?").bind(exceptId || "").all();
  const byTitle = new Map(), byAlias = new Map(); // 비교용 글자 → 그 이름(또는 별칭)을 가진 음식
  for (const r of results) {
    let al = [];
    try { const d = JSON.parse(r.data); if (Array.isArray(d.alias)) al = d.alias.filter((x) => typeof x === "string"); } catch (e) {}
    if (!byTitle.has(aliasNorm(r.title))) byTitle.set(aliasNorm(r.title), r);
    for (const n of al) if (!byAlias.has(aliasNorm(n))) byAlias.set(aliasNorm(n), r);
  }
  // 1) 이름 칸
  const t = v.title, tn = aliasNorm(t);
  const sameTitle = byTitle.get(tn);
  if (sameTitle) throw new InputError("title", `'${t}'${josa(t)} 이미 ${sameTitle.slug} 파일의 이름이야. 다른 이름을 써줘`, { link: `/admin/edit/${sameTitle.id}` });
  const sameAlias = byAlias.get(tn);
  if (sameAlias) throw new InputError("title", `'${t}'${josa(t)} 이미 ${sameAlias.slug} ${sameAlias.title} 파일의 별칭이야. 다른 이름을 쓰거나 그 파일의 별칭을 먼저 빼줘`, { link: `/admin/edit/${sameAlias.id}` });
  // 2) 별칭 칸
  const sent = (Array.isArray(sentAlias) ? sentAlias : []).map((x) => (typeof x === "string" ? aliasNorm(x) : "")); // 화면에서 보낸 순서 (칩 번호)
  for (const a of mine) {
    const o = byTitle.get(aliasNorm(a)) || byAlias.get(aliasNorm(a));
    if (!o) continue;
    const i = Math.max(0, sent.indexOf(aliasNorm(a)));
    throw new InputError(`data.alias.${i}`, `'${a}'${josa(a)} 이미 ${o.slug} ${o.title} 파일에 있어`, { link: `/admin/edit/${o.id}` });
  }
}

const slugConflict = async (c, env, slug, id) =>
  fail(c, 409, "slug_taken", "이 주소는 이미 쓰고 있어", { field: "slug", suggestion: await suggestSlug(env, slug, id) });

// 버전이 안 맞을 때: 휴지통에 갔는지, 다른 곳에서 먼저 고쳤는지 알려 줌
async function versionProblem(c, env, id) {
  const row = await env.DB.prepare("SELECT version, deleted_at FROM contents WHERE id = ?").bind(id).first();
  if (!row) return fail(c, 404, "not_found", "없는 음식 파일이야");
  if (row.deleted_at != null) return fail(c, 409, "trashed", "휴지통에 있는 음식 파일이야");
  return fail(c, 409, "conflict", "다른 곳에서 먼저 고쳤어. 새로 불러올까?", { version: row.version });
}

const getRow = (env, id) => env.DB.prepare("SELECT * FROM contents WHERE id = ?").bind(id).first();
// merged: 같은 음식 안에서 띄어쓰기만 다른 별칭을 합친 개수 → 화면이 "겹치는 별칭 1개를 합쳤어" 알림
const sendRow = async (c, id, status = 200, merged = 0) => c.json({ content: toAdmin(await getRow(c.env, id)), ...(merged ? { merged } : {}) }, status);

// ── 목록 (휴지통 아닌 것) ──
// 거르기: q(이름), year(연도), status(임시저장/발행). 정렬: year(기본, 연도 최신순 → 같은 해 안 순서) / updated(고친 날짜순)
// opts_warn: 발행된 음식인데 오답 보기 중 발행 안 된(또는 휴지통에 간) 음식이 있으면 true → 목록에 "오답 보기 확인 필요"
adminApi.get("/contents", async (c) => {
  const q = (c.req.query("q") || "").trim().slice(0, 40);
  const year = c.req.query("year");
  const status = c.req.query("status");
  const sort = c.req.query("sort") === "updated" ? "updated" : "year";
  const where = ["deleted_at IS NULL"], args = [];
  if (/^\d{4}$/.test(year || "")) where.push("category = ?"), args.push(year);
  if (status === "draft" || status === "published") where.push("status = ?"), args.push(status);
  if (q) where.push("title LIKE ? ESCAPE '\\'"), args.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
  const order = sort === "updated" ? "updated_at DESC" : "category DESC, COALESCE(ord, 9999), title";
  const [list, pub] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, slug, title, category, status, ord, data, published_at, updated_at FROM contents WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 500`).bind(...args),
    c.env.DB.prepare("SELECT slug FROM contents WHERE status = 'published' AND deleted_at IS NULL"),
  ]);
  const ok = new Set(pub.results.map((r) => r.slug));
  const items = list.results.map((r) => {
    let d = {};
    try { d = JSON.parse(r.data); } catch (e) {}
    const opts = Array.isArray(d.opts) ? d.opts : [];
    return { id: r.id, slug: r.slug, title: r.title, category: r.category, status: r.status, ord: r.ord, icon: d.icon || "",
      alias: Array.isArray(d.alias) ? d.alias.filter((x) => typeof x === "string") : [], // 편집 화면이 별칭 겹침을 바로 알려 줄 때 씀
      published_at: r.published_at, updated_at: r.updated_at, opts_warn: r.status === "published" && opts.some((x) => x !== r.slug && !ok.has(x)) };
  });
  return c.json({ items });
});

// ── 휴지통 목록 ──
adminApi.get("/trash", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM contents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500"
  ).all();
  return c.json({ items: results.map((r) => { const a = toAdmin(r); return { id: a.id, type: a.type, title: a.title, deleted_at: a.deleted_at, purge_at: a.purge_at }; }) });
});

// ── 고유 주소 겹침 확인 ──
adminApi.get("/slug-check", async (c) => {
  const slug = (c.req.query("slug") || "").trim();
  const id = c.req.query("id") || "";
  if (!ID_RE.test(slug)) return c.json({ ok: false, message: "영문 소문자·숫자·- 로 2~24자 (예: dzk)" });
  if (await slugTaken(c.env, slug, id)) return c.json({ ok: false, message: "이 주소는 이미 쓰고 있어", suggestion: await suggestSlug(c.env, slug, id) });
  return c.json({ ok: true });
});

// ── 하나 보기 ──
adminApi.get("/contents/:id", async (c) => {
  const row = await getRow(c.env, c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "없는 음식 파일이야");
  return c.json({ content: toAdmin(row) });
});

const jsonLimit = bodyLimit({ maxSize: 256 * 1024, onError: (c) => fail(c, 413, "too_large", "내용이 너무 길어") });

// ── 새로 만들기: 임시저장(기본) 또는 바로 발행(publish: true) ──
adminApi.post("/contents", jsonLimit, async (c) => {
  const env = c.env;
  const input = await readJson(c);
  if (!input) return fail(c, 400, "invalid", "내용이 없어");
  return guard(c, async () => {
    const publish = input.publish === true;
    const v = checkContent(input, { strict: publish });
    if (await slugTaken(env, v.slug, "")) return slugConflict(c, env, v.slug, "");
    await checkNameConflict(env, v, "", input.data && input.data.alias);
    if (publish) await checkImagesExist(env, v), await checkNewOpts(env, v, []);
    const id = newId(), now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO contents (id, type, title, subtitle, body, cover, category, author, status, published_at, slug, sources, ord, data, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(id, v.type, v.title, v.subtitle, v.body, v.cover ? JSON.stringify(v.cover) : null, v.category, v.author,
        publish ? "published" : "draft", publish ? v.published_at ?? now : v.published_at, v.slug, JSON.stringify(v.sources), v.ord,
        JSON.stringify(v.data), now, now),
      ...claimImages(env, id, v),
    ]);
    return sendRow(c, id, 201, v.data.aliasMerged);
  });
});

// 저장 공통: 임시저장(PUT)과 발행(POST /publish)
async function saveContent(c, { publish }) {
  const env = c.env, id = c.req.param("id");
  const input = await readJson(c);
  if (!input) return fail(c, 400, "invalid", "내용이 없어");
  const row = await getRow(env, id);
  if (!row) return fail(c, 404, "not_found", "없는 음식 파일이야");
  if (row.deleted_at != null) return fail(c, 409, "trashed", "휴지통에 있는 음식 파일이야");
  // 발행된 것은 임시본을 따로 두지 않음 → [변경 내용 발행]으로만 저장 (7-3)
  if (!publish && row.status === "published") return fail(c, 409, "published", "발행된 음식 파일은 [변경 내용 발행]으로 저장해줘");
  const version = Number(input.version);
  if (!Number.isInteger(version)) return fail(c, 400, "invalid", "버전 정보가 없어", { field: "version" });
  return guard(c, async () => {
    const v = checkContent({ ...input, type: row.type }, { strict: publish });
    // 한 번이라도 발행한 음식은 고유 주소를 못 바꿈 (영수증 기록·사이트 주소가 이 값을 씀)
    if (row.published_at != null && v.slug !== row.slug) throw new InputError("slug", "발행한 뒤에는 고유 주소를 못 바꿔");
    if (await slugTaken(env, v.slug, id)) return slugConflict(c, env, v.slug, id);
    await checkNameConflict(env, v, id, input.data && input.data.alias);
    if (publish) {
      await checkImagesExist(env, v);
      let oldOpts = [];
      try { oldOpts = JSON.parse(row.data).opts || []; } catch (e) {}
      await checkNewOpts(env, v, oldOpts);
    }
    const now = Date.now();
    const publishedAt = publish ? v.published_at ?? row.published_at ?? now : v.published_at ?? row.published_at;
    const [res] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE contents SET title = ?, subtitle = ?, body = ?, cover = ?, category = ?, author = ?, status = ?, published_at = ?,
           slug = ?, sources = ?, ord = ?, data = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND deleted_at IS NULL`
      ).bind(v.title, v.subtitle, v.body, v.cover ? JSON.stringify(v.cover) : null, v.category, v.author,
        publish ? "published" : "draft", publishedAt, v.slug, JSON.stringify(v.sources), v.ord, JSON.stringify(v.data), now, id, version),
      ...claimImages(env, id, v),
    ]);
    if (!res.meta.changes) return versionProblem(c, env, id);
    return sendRow(c, id, 200, v.data.aliasMerged);
  });
}
adminApi.put("/contents/:id", jsonLimit, (c) => saveContent(c, { publish: false }));
adminApi.post("/contents/:id/publish", jsonLimit, (c) => saveContent(c, { publish: true }));

// 상태만 바꾸는 요청 공통 (version이 맞을 때만)
async function changeState(c, sql, extraWhere, setArgs = []) {
  const env = c.env, id = c.req.param("id");
  const input = (await readJson(c)) || {};
  const version = Number(input.version);
  if (!Number.isInteger(version)) return fail(c, 400, "invalid", "버전 정보가 없어", { field: "version" });
  const res = await env.DB.prepare(`UPDATE contents SET ${sql}, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? ${extraWhere}`)
    .bind(...setArgs, Date.now(), id, version)
    .run();
  if (!res.meta.changes) return versionProblem(c, env, id);
  return sendRow(c, id);
}
// 발행 취소: 임시저장으로 → 사이트에서 바로 사라짐
adminApi.post("/contents/:id/unpublish", (c) => changeState(c, "status = 'draft'", "AND deleted_at IS NULL AND status = 'published'"));
// 휴지통으로: 사이트에서 바로 사라짐 (상태는 그대로 두고 deleted_at만 기록)
adminApi.post("/contents/:id/trash", (c) => changeState(c, "deleted_at = ?", "AND deleted_at IS NULL", [Date.now()]));

// 되살리기: 임시저장 상태로 돌아옴 (바로 다시 발행되지 않음)
adminApi.post("/contents/:id/restore", async (c) => {
  const env = c.env, id = c.req.param("id");
  const res = await env.DB.prepare("UPDATE contents SET deleted_at = NULL, status = 'draft', updated_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NOT NULL")
    .bind(Date.now(), id)
    .run();
  if (!res.meta.changes) return fail(c, 404, "not_found", "휴지통에 없는 음식 파일이야");
  return sendRow(c, id);
});

// 영구 삭제: 휴지통에 있는 것만. 되돌릴 수 없음 (화면에서 확인 창을 먼저 띄움)
adminApi.delete("/contents/:id", async (c) => {
  const ok = await purgeContent(c.env, c.req.param("id"));
  if (!ok) return fail(c, 404, "not_found", "휴지통에 없는 음식 파일이야");
  return c.json({ ok: true });
});

// ── 이미지 올리기 ──
// 브라우저가 미리 가로 1600px 이하로 줄여서 파일 바이트를 그대로 보냄. 서버는 실제 파일 모양까지 확인.
function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
adminApi.post(
  "/images",
  bodyLimit({ maxSize: MAX_IMAGE, onError: (c) => fail(c, 413, "too_large", "올릴 수 없는 파일이야(줄여도 2MB가 넘어)") }),
  async (c) => {
    const env = c.env;
    const contentId = c.req.query("content_id") || null;
    if (contentId && !(await getRow(env, contentId))) return fail(c, 404, "not_found", "없는 음식 파일이야");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) return fail(c, 400, "empty", "파일이 비어 있어");
    if (bytes.length > MAX_IMAGE) return fail(c, 413, "too_large", "올릴 수 없는 파일이야(줄여도 2MB가 넘어)");
    const mime = sniff(bytes);
    if (!mime) return fail(c, 415, "bad_type", "올릴 수 없는 파일이야(JPG·PNG·WebP만 돼)");
    const dim = (k) => {
      const n = Number(c.req.query(k));
      return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
    };
    const id = newImageId();
    await env.STORAGE.put("images/" + id, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare("INSERT INTO images (id, content_id, mime, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, contentId, mime, bytes.length, dim("w"), dim("h"), Date.now())
      .run();
    return c.json({ id, url: "/images/" + id }, 201);
  }
);

