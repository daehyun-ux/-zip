// 입력 검사·정리 (design-admin.md 5장, 11/25 수정본: 음식 파일 전용). 옛 server/src/validate.js 규칙을 그대로 옮겨 옴.
// 사이트가 이 글들을 HTML로 넣기 때문에 허용 태그(<br>, <b>)만 남기고 나머지 '<'는 막는다.
// strict=false(임시저장)면 비어 있어도 통과, strict=true(발행)면 필수 칸·개수까지 검사한다.

export class InputError extends Error {
  constructor(field, message, extra = {}) {
    super(message);
    this.field = field;
    this.extra = extra; // 응답에 같이 실을 것 (예: 겹친 음식 편집 링크)
  }
}
const bad = (field, msg) => {
  throw new InputError(field, msg);
};

export const FOOD_YEARS = [2014, 2016, 2018, 2020, 2022, 2024, 2026]; // index.html의 FOOD_YEARS와 같게
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,23}$/; // 고유 주소(= 사이트의 음식 번호): 영문 소문자·숫자·- 2~24자
export const IMG_RE = /^[a-f0-9]{24}$/;
export const ICONS = new Set(["cookie","mochi","choco","yogurt","bread","coffee","sotteok","castella","chips","note","heart","phone","target","apt","bowl","shark","mic","bucket","retro","croffle","yakgwa","gopchang","chocopie","honeycomb","globe","flame","film","pin","snow","jjamppong","jjajang","hotdog","pho","bubbletea","mala","kkobuk","rose","tanghulu","snackbag","bingsu","towel","tv","mask","trophy","penguin","shapes","megaphone","arrow","stone","star","tangerine","naengmyeon","subakbar","whale","receipt","injeolmi","soju","juice","grape","chickenskin","beer","zerocan","creambread","donut","bagel","tiramisu","matcha","buttermochi","bomdong","trend","magnify"]); // index.html의 <symbol id> 71개와 같게

const empty = (v) => v == null || (typeof v === "string" && v.trim() === "");

// 본문용: <br>, <b>, </b>만 허용. 다른 '<'는 전각 '＜'로 바꿔서 태그가 안 되게
export function rich(v, field, max, required) {
  if (empty(v)) {
    if (required) bad(field, "비어 있어");
    return "";
  }
  if (typeof v !== "string") bad(field, "글자여야 해");
  let s = v.replace(/\r\n?/g, "\n").trim().replace(/\n/g, "<br>");
  s = s.replace(/<(?!\/?b>|br\s*\/?>)/gi, "＜").replace(/<br\s*\/?>/gi, "<br>");
  if (s.replace(/<\/?b>|<br>/g, "").length > max) bad(field, `${max}자 이하로 써줘`);
  return s;
}
// 속성에도 들어가는 짧은 글: 줄바꿈·따옴표·꺾쇠 금지
export function plain(v, field, max, required) {
  if (empty(v)) {
    if (required) bad(field, "비어 있어");
    return "";
  }
  if (typeof v !== "string") bad(field, "글자여야 해");
  const s = v.replace(/\s+/g, " ").trim().replace(/["<>`]/g, "");
  if (!s && required) bad(field, "비어 있어");
  if (s.length > max) bad(field, `${max}자 이하로 써줘`);
  return s;
}
// 통계 이름처럼 줄바꿈(<br>)만 허용
function label(v, field, max, required) {
  if (empty(v)) {
    if (required) bad(field, "비어 있어");
    return "";
  }
  if (typeof v !== "string") bad(field, "글자여야 해");
  const s = v.replace(/\r\n?|\n/g, "<br>").replace(/<br\s*\/?>/gi, "\u0000").replace(/["<>`]/g, "").replace(/\u0000/g, "<br>").trim();
  if (s.replace(/<br>/g, "").length > max) bad(field, `${max}자 이하로 써줘`);
  return s;
}
export function url(v, field, required) {
  if (empty(v)) {
    if (required) bad(field, "주소가 비어 있어");
    return "";
  }
  let u;
  try {
    u = new URL(String(v).trim());
  } catch (e) {
    bad(field, "http(s) 주소만 넣을 수 있어");
  }
  if (!/^https?:$/.test(u.protocol)) bad(field, "http(s) 주소만 넣을 수 있어");
  const s = u.toString();
  if (s.length > 500 || /["<>\s`]/.test(s)) bad(field, "주소에 쓸 수 없는 글자가 있어");
  return s;
}
function list(v, field, min, max) {
  if (v == null) v = [];
  if (!Array.isArray(v)) bad(field, "목록이어야 해");
  if (v.length < min || v.length > max) bad(field, min === max ? `${min}개여야 해` : min ? `${min}~${max}개 넣어줘` : `${max}개까지 넣을 수 있어`);
  return v;
}
function int(v, field, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(field, `${min}~${max} 사이 숫자로 넣어줘`);
  return n;
}

// 대표 이미지 {id, alt, credit, url}. 이미지를 넣었으면 대체 글은 (발행할 때) 필수
function cover(v, strict) {
  if (v == null || v === "" || (typeof v === "object" && empty(v.id))) return null;
  if (typeof v !== "object") bad("cover", "형식 오류");
  if (!IMG_RE.test(String(v.id))) bad("cover", "이미지 번호가 잘못됐어");
  const c = { id: String(v.id), alt: plain(v.alt, "cover.alt", 120, strict), credit: plain(v.credit, "cover.credit", 120, false) };
  const u = url(v.url, "cover.url", false);
  if (u) c.url = u;
  return c;
}

function sources(v, strict) {
  const min = strict ? 1 : 0;
  return list(v, "sources", min, 12)
    .map((s, i) => {
      if (!Array.isArray(s)) bad(`sources.${i}`, "형식 오류");
      const name = plain(s[0], `sources.${i}.0`, 80, strict);
      const link = url(s[1], `sources.${i}.1`, strict);
      return [name, link];
    })
    .filter(([n, l]) => strict || n || l);
}

// ── 검색 별칭 (design-alias.md 5장) ──
// 비교는 사이트 검색 srNorm과 같게: 띄어쓰기 지우고 소문자
export const aliasNorm = (t) => String(t).toLowerCase().replace(/\s+/g, "");
export const ALIAS_MAX = 5;
const ALIAS_LEN = 20; // 사이트 검색 칸이 20자까지만 받음(srClean)
const ALIAS_OK = /^[가-힣A-Za-z0-9 \-·&']+$/; // 한글·영문·숫자·띄어쓰기·- · & '
// 돌려주는 값: { list: 정리한 별칭들, merged: 같은 음식 안에서 합친 개수 }
// 오류 칸 이름은 data.alias.<보낸 순서 번호> → 화면이 그 칩에 빨간 테두리를 그림
export function aliasList(v, title) {
  if (v == null) return { list: [], merged: 0 };
  if (!Array.isArray(v)) bad("data.alias", "별칭은 목록이어야 해");
  if (v.length > 20) bad("data.alias", `별칭은 ${ALIAS_MAX}개까지야`);
  const own = aliasNorm(title || "");
  const seen = new Set(), list = [];
  let merged = 0;
  v.forEach((a, i) => {
    const f = `data.alias.${i}`;
    if (typeof a !== "string") bad(f, "별칭은 글자여야 해");
    const s = a.replace(/\s+/g, " ").trim(); // 여러 칸 띄어쓰기 → 한 칸
    if (!s) return; // 빈 칸은 그냥 뺌
    if (s.length > ALIAS_LEN) bad(f, `별칭은 ${ALIAS_LEN}자까지야`);
    if (/^[ㄱ-ㅎ ]+$/.test(s)) bad(f, "초성 검색은 자동으로 돼. 글자로 넣어줘");
    if (!ALIAS_OK.test(s)) bad(f, `쓸 수 없는 글자가 있어: ${[...s].find((ch) => !ALIAS_OK.test(ch))}`);
    const n = aliasNorm(s);
    if (n === own) bad(f, "이름과 같은 별칭은 필요 없어");
    if (seen.has(n)) return void merged++; // 띄어쓰기·대소문자만 다른 별칭 → 하나만 남김
    seen.add(n);
    list.push(s);
  });
  if (list.length > ALIAS_MAX) bad("data.alias", `별칭은 ${ALIAS_MAX}개까지야`);
  return { list, merged };
}

// 음식 전용 칸 (data). 옛 validate.js의 food() 규칙
function foodData(d, strict, title) {
  if (d == null) d = {};
  if (typeof d !== "object") bad("data", "형식 오류");
  const f = {};
  const icon = String(d.icon || "").trim();
  if (!icon) {
    if (strict) bad("data.icon", "아이콘을 골라줘");
  } else if (icon.startsWith("img:")) {
    if (!IMG_RE.test(icon.slice(4))) bad("data.icon", "사진 아이콘 번호가 잘못됐어");
  } else if (icon.startsWith("emoji:")) {
    const e = icon.slice(6);
    // 이모지 1개(피부색·결합 문자 포함). 글자·숫자·기호는 막음
    if (!e || e.length > 16 || /[\s<>"'`&]/.test(e) || !/\p{Extended_Pictographic}/u.test(e) || /[\p{L}\p{N}]/u.test(e)) bad("data.icon", "이모지 하나만 넣어줘 (예: 🍩)");
  } else if (!ICONS.has(icon)) bad("data.icon", "목록에 있는 아이콘을 골라줘");
  if (icon) f.icon = icon;

  if (d.hints != null && !Array.isArray(d.hints)) bad("data.hints", "힌트는 꼭 3개여야 해");
  if (strict && (!Array.isArray(d.hints) || d.hints.length !== 3)) bad("data.hints", "힌트는 꼭 3개여야 해");
  f.hints = list(d.hints, "data.hints", 0, 3).map((h, i) => {
    if (!Array.isArray(h)) bad(`data.hints.${i}`, "형식 오류");
    return [rich(h[0], `data.hints.${i}.0`, 200, strict), rich(h[1], `data.hints.${i}.1`, 140, false)];
  });
  if (d.hintsAlt != null) {
    const alt = list(d.hintsAlt, "data.hintsAlt", 0, 3).map((h, i) => {
      if (!Array.isArray(h)) bad(`data.hintsAlt.${i}`, "형식 오류");
      return [rich(h[0], `data.hintsAlt.${i}.0`, 200, false), rich(h[1], `data.hintsAlt.${i}.1`, 140, false)];
    });
    if (alt.some((h) => h[0] || h[1])) f.hintsAlt = alt;
  }
  f.opts = list(d.opts, "data.opts", strict ? 1 : 0, 6).map((id, i) => {
    if (!ID_RE.test(String(id))) bad(`data.opts.${i}`, "음식 번호 형식이 아니야");
    return String(id);
  });
  f.desc = rich(d.desc, "data.desc", 200, strict);
  f.tags = list(d.tags, "data.tags", 0, 8).map((t, i) => plain(t, `data.tags.${i}`, 24, true));
  const head = d.head || {};
  f.head = { t: rich(head.t, "data.head.t", 200, strict), m: plain(head.m, "data.head.m", 80, strict) };
  if (head.sum) f.head.sum = true;
  f.stats = list(d.stats, "data.stats", 0, 4).map((s, i) => {
    if (!Array.isArray(s)) bad(`data.stats.${i}`, "형식 오류");
    const row = [label(s[0], `data.stats.${i}.0`, 60, true), plain(s[1], `data.stats.${i}.1`, 24, true), int(s[2] ?? i % 3, `data.stats.${i}.2`, 0, 2)];
    if (s[3]) row.push(1);
    return row;
  });
  f.note = rich(d.note, "data.note", 800, false);
  f.why = list(d.why, "data.why", strict ? 1 : 0, 6).map((w, i) => rich(w, `data.why.${i}`, 400, strict));
  const now = d.now || {};
  f.now = { when: plain(now.when, "data.now.when", 40, strict), t: rich(now.t, "data.now.t", 1200, strict) };
  if (!empty(d.verb)) f.verb = plain(d.verb, "data.verb", 8, false);
  // 별칭: 있을 때만 저장 (없는 음식은 칸 자체가 없음 → 003 옮기기가 '아직 없음'으로 알아봄)
  const al = aliasList(d.alias, title);
  if (al.list.length) f.alias = al.list;
  Object.defineProperty(f, "aliasMerged", { value: al.merged, enumerable: false }); // DB에는 안 들어감, 응답 알림용
  return f;
}

// 음식 파일 한 건 검사. 돌려주는 값은 DB에 그대로 넣을 수 있는 모양
// input: { title, subtitle, body, cover, category, author, slug, sources, ord, published_at, data }
export const AUTHOR_DEFAULT = "관리자";
export function content(input, { strict }) {
  if (!input || typeof input !== "object") bad("data", "내용이 없어");
  if (input.type != null && input.type !== "food") bad("type", "지금은 음식 파일만 만들 수 있어");
  const out = { type: "food" };
  // 임시저장에도 이름과 고유 주소는 꼭 있어야 함 (10장)
  if (empty(input.title)) bad("title", "이름이랑 고유 주소는 있어야 저장돼");
  if (empty(input.slug)) bad("slug", "이름이랑 고유 주소는 있어야 저장돼");
  out.title = plain(input.title, "title", 40, true);
  const slug = String(input.slug).trim();
  if (!ID_RE.test(slug)) bad("slug", "영문 소문자·숫자·- 로 2~24자 (예: dzk)");
  out.slug = slug;
  out.subtitle = plain(input.subtitle, "subtitle", 80, false);
  out.body = rich(input.body, "body", 1200, strict);
  out.cover = cover(input.cover, strict); // 이미지가 있으면 (발행할 때) 대체 글 필수

  const cat = empty(input.category) ? "" : String(input.category).trim();
  if (cat && !FOOD_YEARS.includes(Number(cat))) bad("category", "연도는 2014~2026 짝수 해 중에서 골라줘");
  if (strict && !cat) bad("category", "연도를 골라줘");
  out.category = cat;

  out.author = plain(input.author, "author", 20, false) || AUTHOR_DEFAULT; // 필수 아님. 비면 "관리자"
  out.sources = sources(input.sources, strict);
  out.ord = input.ord == null || input.ord === "" ? null : int(input.ord, "ord", 0, 9999);
  out.published_at = input.published_at == null || input.published_at === "" ? null : int(input.published_at, "published_at", 0, 4102444800000);
  out.data = foodData(input.data, strict, out.title);
  return out;
}

// 영수증 (옛 validate.js의 receipt 그대로)
export function receipt(input) {
  if (!input || typeof input !== "object") bad("receipt", "영수증 정보가 없어");
  const clientId = String(input.clientId || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clientId)) bad("clientId", "형식 오류");
  const r = input.receipt || {};
  const items = list(r.items, "items", 0, 200).map((x, i) => {
    if (!x || typeof x !== "object" || !ID_RE.test(String(x.id || ""))) bad(`items.${i}`, "형식 오류");
    return {
      id: String(x.id),
      hints: int(x.hints ?? 1, `items.${i}.hints`, 1, 3),
      ms: x.ms == null ? null : int(Math.round(x.ms), `items.${i}.ms`, 0, 864e5),
      solved: !!x.solved,
      wrong: int(x.wrong ?? 0, `items.${i}.wrong`, 0, 99),
      ate: ["y", "n", "m"].includes(x.ate) ? x.ate : null,
    };
  });
  return {
    clientId,
    data: {
      items,
      total: int(r.total ?? items.length, "total", 0, 1000),
      sens: r.sens == null ? null : int(r.sens, "sens", 0, 100),
      rank: r.rank ? plain(String(r.rank), "rank", 30, false) : null,
      ate: int(r.ate ?? items.filter((x) => x.ate === "y").length, "ate", 0, 1000),
    },
  };
}
