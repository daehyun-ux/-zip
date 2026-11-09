// seed/foods.json을 DB에 넣음. 이미 있는 id는 건너뜀(--force면 덮어씀)
// 사용: npm run seed            (비어 있는 것만 채움)
//       npm run seed -- --force (seed 내용으로 덮어씀 — 관리자 페이지에서 고친 내용이 사라지니 주의)
const fs = require("node:fs");
const path = require("node:path");
const V = require("../src/validate");

async function importFoods(db, list, { force = false, by = "seed" } = {}) {
  let inserted = 0, updated = 0, skipped = 0;
  const now = Date.now();
  for (const item of list) {
    const f = V.food(item.food);
    const { id, year, ...rest } = f;
    const published = item.published !== false;
    const ex = await db.query("select id from foods where id = ?", [id]);
    if (ex[0] && !force) { skipped++; continue; }
    if (ex[0]) { await db.query("update foods set year = ?, published = ?, data = ?, updated_at = ?, updated_by = ? where id = ?", [year, published, JSON.stringify(rest), now, by, id]); updated++; }
    else { await db.query("insert into foods (id, year, published, data, updated_at, updated_by) values (?, ?, ?, ?, ?, ?)", [id, year, published, JSON.stringify(rest), now, by]); inserted++; }
  }
  return { inserted, updated, skipped };
}

// seed/migrations/*.json: 이미 돌아가는 DB에 한 번만 적용할 변경
//   { "id": "...", "hide": ["음식id"], "upsert": [{ "food": {...}, "published": true }] }
async function runMigrations(db) {
  const dir = path.join(__dirname, "..", "seed", "migrations");
  if (!fs.existsSync(dir)) return [];
  await db.exec("create table if not exists migrations (id text primary key, applied_at bigint not null)");
  const done = new Set((await db.query("select id from migrations")).map(r => r.id));
  const applied = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (!m.id || done.has(m.id)) continue;
    const now = Date.now();
    for (const id of m.hide || []) await db.query("update foods set published = ?, updated_at = ?, updated_by = ? where id = ?", [false, now, "migration", id]);
    if (m.upsert && m.upsert.length) await importFoods(db, m.upsert, { force: true, by: "migration" });
    await db.query("insert into migrations (id, applied_at) values (?, ?)", [m.id, now]);
    applied.push(m.id);
  }
  return applied;
}

module.exports = { importFoods, runMigrations };

if (require.main === module) {
  (async () => {
    const { connect } = require("../src/db");
    const db = await connect();
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "foods.json"), "utf8"));
    const r = await importFoods(db, list, { force: process.argv.includes("--force") });
    console.log(`새로 넣음 ${r.inserted} · 덮어씀 ${r.updated} · 건너뜀 ${r.skipped}`);
    await db.close();
  })().catch(e => { console.error(e.message); process.exit(1); });
}
