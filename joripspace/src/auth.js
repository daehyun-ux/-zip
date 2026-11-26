// 관리자 로그인 (design-admin.md 6장)
// - 비밀번호는 조립스페이스 비밀값 ADMIN_PASSWORD에만 있다. 코드에는 없다.
// - 로그인하면 무작위 값을 쿠키로 주고, DB에는 그 값의 해시(SESSION_SECRET으로 서명)만 둔다.
// - 세션마다 '로그인 당시 비밀번호 지문(pw_tag)'을 같이 저장 → 비밀번호를 바꾸면 예전 로그인은 모두 풀린다.
// - 같은 접속 주소(IP)에서 10분 안에 5번 틀리면 10분 동안 막는다.
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

export const COOKIE = "__Host-mz_admin";
const WEEK = 7 * 24 * 60 * 60; // 초
const TEN_MIN = 10 * 60 * 1000;
const MAX_FAILS = 5;

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
// 길이가 같은 두 글자를 걸리는 시간이 같게 비교
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 비밀값이 둘 다 있어야 로그인 기능이 켜진다. 비밀번호가 12자보다 짧으면 설정 안 된 것으로 봄(design-admin.md 6장)
export const isConfigured = (env) => typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length >= 12 && typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 16;
const pwTag = (env) => hmac(env.SESSION_SECRET, "pw:" + env.ADMIN_PASSWORD);
const tokenHash = (env, token) => hmac(env.SESSION_SECRET, "session:" + token);
const clientKey = (c) => "ip:" + (c.req.header("CF-Connecting-IP") || "unknown");

// 변경 요청(POST 등)은 같은 사이트에서 온 것만 받는다 (다른 사이트에서 몰래 보내는 요청 막기)
export function sameOrigin(c) {
  const origin = c.req.header("Origin");
  if (origin) return origin === new URL(c.req.url).origin;
  return c.req.header("Sec-Fetch-Site") === "same-origin";
}

// 지금 막혀 있는지: 최근 실패 5번이 10분 안에 몰려 있고, 마지막 실패에서 10분이 안 지났으면 막힘
async function lockedUntil(env, key, now) {
  const { results } = await env.DB.prepare("SELECT at FROM login_failures WHERE key = ? AND at > ? ORDER BY at DESC LIMIT ?")
    .bind(key, now - 2 * TEN_MIN, MAX_FAILS)
    .all();
  if (results.length < MAX_FAILS) return 0;
  const last = results[0].at, fifth = results[MAX_FAILS - 1].at;
  if (last - fifth <= TEN_MIN && now < last + TEN_MIN) return last + TEN_MIN;
  return 0;
}

// 로그인 안 했으면 데이터를 하나도 주지 않는다
export async function currentSession(c) {
  const env = c.env;
  if (!isConfigured(env)) return null;
  const token = getCookie(c, COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT token_hash, pw_tag FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await tokenHash(env, token), Date.now())
    .first();
  if (!row || !sameText(row.pw_tag, await pwTag(env))) return null;
  return row;
}

const noStore = (c) => {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
};

// /api/admin/* 앞에 붙는 검사
export const requireAdmin = createMiddleware(async (c, next) => {
  noStore(c);
  if (!["GET", "HEAD"].includes(c.req.method) && !sameOrigin(c)) return c.json({ error: "origin_not_allowed" }, 403);
  const s = await currentSession(c);
  if (!s) return c.json({ error: "login_required" }, 401);
  c.set("session", s);
  await next();
});

// 로그인·로그아웃·상태 확인 경로
export function mountAuth(app) {
  // 로그인 화면이 "비밀번호가 아직 설정되지 않았어"를 보여 줄지 정할 때 씀
  app.get("/api/admin/status", async (c) => {
    noStore(c);
    const configured = isConfigured(c.env);
    return c.json({ configured, loggedIn: configured && !!(await currentSession(c)) });
  });

  app.post("/api/admin/login", async (c) => {
    noStore(c);
    const env = c.env;
    if (!sameOrigin(c)) return c.json({ error: "origin_not_allowed" }, 403);
    if (!isConfigured(env)) return c.json({ error: "not_configured", message: "관리자 비밀번호가 아직 설정되지 않았어" }, 503);
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      body = {};
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return c.json({ error: "empty", message: "비밀번호를 넣어줘" }, 400);
    if (password.length > 200) return c.json({ error: "wrong", message: "비밀번호가 달라" }, 401);

    const key = clientKey(c), now = Date.now();
    if (await lockedUntil(env, key, now)) return c.json({ error: "locked", message: "잠시 막혔어. 10분 뒤 다시 해줘" }, 429);

    const ok = sameText(await hmac(env.SESSION_SECRET, "try:" + password), await hmac(env.SESSION_SECRET, "try:" + env.ADMIN_PASSWORD));
    if (!ok) {
      await env.DB.prepare("INSERT INTO login_failures (key, at) VALUES (?, ?)").bind(key, now).run();
      if (await lockedUntil(env, key, now)) return c.json({ error: "locked", message: "잠시 막혔어. 10분 뒤 다시 해줘" }, 429);
      return c.json({ error: "wrong", message: "비밀번호가 달라" }, 401); // 남은 횟수는 알려 주지 않음
    }

    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_sessions (token_hash, pw_tag, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(await tokenHash(env, token), await pwTag(env), now + WEEK * 1000, now),
      env.DB.prepare("DELETE FROM login_failures WHERE key = ?").bind(key),
    ]);
    setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: WEEK });
    return c.json({ ok: true });
  });

  app.post("/api/admin/logout", async (c) => {
    noStore(c);
    if (!sameOrigin(c)) return c.json({ error: "origin_not_allowed" }, 403);
    const token = getCookie(c, COOKIE);
    if (token && /^[a-f0-9]{64}$/.test(token) && isConfigured(c.env)) {
      await c.env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await tokenHash(c.env, token)).run();
    }
    deleteCookie(c, COOKIE, { path: "/", secure: true });
    return c.json({ ok: true });
  });
}
