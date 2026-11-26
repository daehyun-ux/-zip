// index.html 안의 음식 데이터를 꺼내 DB에 넣는 SQL(migrations/002_seed_foods.sql)을 만든다. (design-admin.md 8-1)
// 실행: node scripts/extract-foods.mjs
// - 힌트: HARD에 있는 음식은 HARD 값을 hints로, 원래 FOODS의 hints는 hintsAlt로 넣는다.
// - 지금 사이트에 보이는 음식(짝수 해, HIDE_IDS 제외)은 발행, 나머지(홀수 해·btt)는 임시저장.
// - 문화(CULTURE)는 옮기지 않는다.
// 이 스크립트는 내 PC에서만 돌린다. 사이트·서버에는 들어가지 않는다.
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const ROOT = new URL("..", import.meta.url);
const html = readFileSync(new URL("index.html", ROOT), "utf8");

// 데이터 부분만 잘라서 따로 실행한다 (화면 코드는 실행하지 않음)
const cut = (start, end) => {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`index.html에서 '${start}' ~ '${end}' 구간을 못 찾았어`);
  return html.slice(a, b);
};
const dataJs = cut("const FOODS = [", "const YORDER=");
const hardJs = cut("const HARD={", "if(!MZ)ITEMS.forEach(f=>{if(HARD[f.id])"); // 11/25 4단계에서 index.html 이 줄 앞에 if(!MZ)가 붙음
const yearsJs = cut("const FOOD_YEARS=", ";");
const hideJs = cut("const HIDE_IDS=", ";");
const { FOODS, HARD, FOOD_YEARS, HIDE_IDS } = runInNewContext(
  `${dataJs};${hardJs};${yearsJs};${hideJs};({FOODS,HARD,FOOD_YEARS,HIDE_IDS})`
);

// 사이트와 같은 순서: 연도 순(YORDER)으로 정렬. 같은 해 안에서는 원래 순서 유지
const YORDER = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014];
const sorted = FOODS.slice().sort((a, b) => YORDER.indexOf(a.year) - YORDER.indexOf(b.year));
const isVisible = (f) => FOOD_YEARS.includes(f.year) && !HIDE_IDS.includes(f.id);
const visible = sorted.filter(isVisible);
const hidden = sorted.filter((f) => !isVisible(f));

// 같은 해 안 순서(ord): 보이는 음식 먼저 0,1,2… 그 뒤로 숨긴 음식
const ordOf = new Map();
const nextOrd = {};
for (const f of [...visible, ...hidden]) {
  nextOrd[f.year] = nextOrd[f.year] ?? 0;
  ordOf.set(f.id, nextOrd[f.year]++);
}

const SEED_AT = Date.parse("2026-11-25T00:00:00+09:00"); // 옮긴 날짜로 고정 (다시 만들어도 같은 SQL)
const AUTHOR = "관리자"; // 필자 기본값 (design-admin.md 5-1). 사이트엔 안 보이고 기록용

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => q(JSON.stringify(v));

const rows = [...visible, ...hidden].map((f) => {
  const published = isVisible(f);
  const data = {
    icon: f.icon,
    hints: HARD[f.id] || f.hints,
    ...(HARD[f.id] ? { hintsAlt: f.hints } : {}),
    opts: f.opts,
    desc: f.desc,
    tags: f.tags,
    head: f.head,
    stats: f.stats,
    note: f.note,
    why: f.why,
    now: f.now,
    ...(f.verb ? { verb: f.verb } : {}),
  };
  const values = [
    q(f.id), q("food"), q(f.name), q(f.sub || ""), q(f.remember || ""), "NULL",
    q(String(f.year)), q(AUTHOR), q(published ? "published" : "draft"), "NULL",
    published ? q(SEED_AT) : "NULL", q(f.id), json(f.src || []), q(ordOf.get(f.id)),
    json(data), q(SEED_AT), q(SEED_AT), "1",
  ];
  return `INSERT INTO contents (id, type, title, subtitle, body, cover, category, author, status, deleted_at, published_at, slug, sources, ord, data, created_at, updated_at, version)\nVALUES (${values.join(", ")})\nON CONFLICT(id) DO NOTHING;`;
});

const header = [
  "-- index.html 음식 데이터를 DB로 옮기기 (한 번만). scripts/extract-foods.mjs가 만든 파일이라 직접 고치지 말 것.",
  "-- 적용: joripspace db migrate --project mukubowzip --file migrations/002_seed_foods.sql",
  `-- 발행 ${visible.length}개: ${visible.map((f) => f.id).join(", ")}`,
  `-- 임시저장 ${hidden.length}개: ${hidden.map((f) => f.id).join(", ")}`,
  "-- 이미 같은 id가 있으면 건너뜀(관리자 페이지에서 고친 내용을 덮어쓰지 않음).",
  "",
].join("\n");

const out = new URL("migrations/002_seed_foods.sql", ROOT);
writeFileSync(out, header + rows.join("\n\n") + "\n");
console.log(`만듦: migrations/002_seed_foods.sql (발행 ${visible.length}개, 임시저장 ${hidden.length}개)`);
