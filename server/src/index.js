// 먹어봤.zip 서버 시작점
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { connect } = require("./db");
const { HttpError, send, corsHeaders } = require("./http");
const { build, serveAdmin } = require("./routes");
const auth = require("./auth");
const { importFoods, runMigrations } = require("../scripts/seed");

async function main() {
  const db = await connect();
  console.log(`[db] ${db.kind === "postgres" ? "Postgres 연결됨" : "로컬 SQLite: " + config.sqliteFile}`);

  // 처음 켰을 때 음식 표가 비어 있으면 기존 사이트 데이터(seed/foods.json)를 자동으로 넣음
  const [{ n }] = await db.query("select count(*) as n from foods");
  if (Number(n) === 0) {
    const file = path.join(__dirname, "..", "seed", "foods.json");
    if (fs.existsSync(file)) {
      const r = await importFoods(db, JSON.parse(fs.readFileSync(file, "utf8")));
      console.log(`[seed] 기존 음식 ${r.inserted}개를 DB에 넣었어`);
    }
  }
  // 데이터 변경 묶음(seed/migrations/*.json)을 한 번씩만 적용
  const r = await runMigrations(db);
  if (r.length) console.log(`[migrate] ${r.join(", ")} 적용`);
  const admins = await auth.ensureBootstrapAdmin(db);
  if (!admins) console.log("[admin] 관리자 계정이 아직 없어. ADMIN_USERNAME / ADMIN_PASSWORD 환경변수를 넣거나 `npm run admin -- add 아이디`로 만들어줘");

  const router = build(db);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const started = Date.now();
    res.on("finish", () => { if (!config.isProd || res.statusCode >= 500) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`); });
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders(req)); res.end(); return; }
      if (url.pathname === "/" ) { send(res, 200, "먹어봤.zip API 서버가 켜져 있어. 관리자 페이지는 /admin"); return; }
      if (url.pathname === "/admin") { res.writeHead(301, { Location: "/admin/" }); res.end(); return; }
      if (url.pathname.startsWith("/admin/") && (req.method === "GET" || req.method === "HEAD")) { if (serveAdmin(req, res, url.pathname)) return; }
      const hit = router.match(req.method, url.pathname);
      if (!hit) throw new HttpError(404, "없는 주소야");
      if (hit.methodNotAllowed) throw new HttpError(405, "지원하지 않는 방식이야");
      const ctx = { params: hit.params, query: url.searchParams };
      for (const h of hit.handlers) { await h(req, res, ctx); if (res.headersSent) break; }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      const headers = { ...corsHeaders(req) };
      if (e.extra && e.extra.retryAfter) headers["Retry-After"] = String(e.extra.retryAfter);
      send(res, status, { error: status === 500 ? "서버에 문제가 생겼어" : e.message, field: e.extra && e.extra.field }, headers);
    }
  });
  server.requestTimeout = 30000;
  server.listen(config.port, () => console.log(`[server] http://localhost:${config.port}  (관리자: /admin)`));

  const stop = async () => { server.close(); await db.close(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}

main().catch(e => { console.error(e); process.exit(1); });
