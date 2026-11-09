// 사이트 파일(meogeobwat.html)에서 음식 39개와 아이콘 목록을 꺼내 seed/foods.json, src/icons.json, public/admin/icons.svg를 만듦
// 사용: npm run extract -- ../source/meogeobwat.html
const fs = require("node:fs");
const path = require("node:path");

const src = process.argv[2] || path.join(__dirname, "..", "..", "source", "meogeobwat.html");
const html = fs.readFileSync(src, "utf8");

const cut = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`사이트 파일에서 '${from}' ~ '${to}' 구간을 못 찾았어`);
  return html.slice(a, b);
};

// 1) 음식 데이터: FOODS 선언부터 '짝수 해만 표시' 필터 직전까지 실행해서 39개 전부 얻음
const dataJs = cut("const FOODS = [", "const SHOW_CULTURE");
const FOODS = new Function(dataJs + "\nreturn FOODS;")();
// 2) 어려운 힌트(HARD): 사이트에서는 이게 실제로 쓰이는 힌트
const hardJs = cut("const HARD={", "ITEMS.forEach(f=>{if(HARD");
const HARD = new Function(hardJs + "\nreturn HARD;")();
// 3) 보이는 연도
const fy = html.match(/const FOOD_YEARS=\[([\d,\s]+)\]/);
const FOOD_YEARS = fy ? fy[1].split(",").map(Number) : [];
const hi = html.match(/const HIDE_IDS=\[([^\]]*)\]/);
const HIDE_IDS = hi ? [...hi[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [];

const out = FOODS.map((f, i) => {
  const { cat, verb, opts, ...rest } = f;
  const food = { ...rest, ord: i * 10 };
  if (HARD[f.id]) { food.hintsAlt = f.hints; food.hints = HARD[f.id]; }
  return { food, published: (FOOD_YEARS.length ? FOOD_YEARS.includes(f.year) : true) && !HIDE_IDS.includes(f.id) };
});

// 4) 아이콘: 사이트의 SVG 심볼
const sprite = html.match(/<svg[^>]*style="display:none"[^>]*>[\s\S]*?<\/svg>/) || html.match(/<svg[^>]*width="0"[^>]*>[\s\S]*?<\/svg>/);
if (!sprite) throw new Error("아이콘 SVG를 못 찾았어");
const ids = [...sprite[0].matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]);

const root = path.join(__dirname, "..");
fs.mkdirSync(path.join(root, "seed"), { recursive: true });
fs.writeFileSync(path.join(root, "seed", "foods.json"), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, "src", "icons.json"), JSON.stringify(ids));
fs.mkdirSync(path.join(root, "public", "admin"), { recursive: true });
const svg = sprite[0].replace(/<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg">');
fs.writeFileSync(path.join(root, "public", "admin", "icons.svg"), svg);
console.log(`음식 ${out.length}개 (공개 ${out.filter(x => x.published).length}개), 아이콘 ${ids.length}개를 꺼냈어`);
