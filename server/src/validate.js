// 음식 데이터 검사·정리. 사이트가 이 글들을 HTML로 넣기 때문에 허용 태그(<br>, <b>)만 남기고 막음
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("./http");

const ICONS = (() => {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "icons.json"), "utf8"))); } catch (e) { return new Set(); }
})();

const bad = (field, msg) => { throw new HttpError(400, `${field}: ${msg}`, { field }); };

// 본문용: <br>, <b>, </b>만 허용. 다른 '<'는 전각 '＜'로 바꿔서 태그가 안 되게
function rich(v, field, max, { required = true } = {}) {
  if (v == null || v === "") { if (required) bad(field, "비어 있어"); return ""; }
  if (typeof v !== "string") bad(field, "글자여야 해");
  let s = v.replace(/\r\n?/g, "\n").trim().replace(/\n/g, "<br>");
  s = s.replace(/<(?!\/?b>|br\s*\/?>)/gi, "＜").replace(/<br\s*\/?>/gi, "<br>");
  if (!s && required) bad(field, "비어 있어");
  if (s.replace(/<\/?b>|<br>/g, "").length > max) bad(field, `${max}자 이하로`);
  return s;
}
// 속성에도 들어가는 짧은 글: 따옴표·꺾쇠 금지
function plain(v, field, max, { required = true } = {}) {
  if (v == null || v === "") { if (required) bad(field, "비어 있어"); return ""; }
  if (typeof v !== "string") bad(field, "글자여야 해");
  const s = v.replace(/\s+/g, " ").trim().replace(/["<>`]/g, "");
  if (!s && required) bad(field, "비어 있어");
  if (s.length > max) bad(field, `${max}자 이하로`);
  return s;
}
// 통계 이름처럼 줄바꿈(<br>)만 허용
function label(v, field, max) {
  if (typeof v !== "string" || !v.trim()) bad(field, "비어 있어");
  const s = v.replace(/\r\n?|\n/g, "<br>").replace(/<br\s*\/?>/gi, "\u0000").replace(/["<>`]/g, "").replace(/\u0000/g, "<br>").trim();
  if (s.replace(/<br>/g, "").length > max) bad(field, `${max}자 이하로`);
  return s;
}
function url(v, field, { required = true } = {}) {
  if (v == null || v === "") { if (required) bad(field, "주소가 비어 있어"); return ""; }
  let u;
  try { u = new URL(String(v).trim()); } catch (e) { bad(field, "주소 형식이 아니야"); }
  if (!/^https?:$/.test(u.protocol)) bad(field, "http(s) 주소만");
  const s = u.toString();
  if (s.length > 500 || /["<>\s`]/.test(s)) bad(field, "주소에 쓸 수 없는 글자가 있어");
  return s;
}
const arr = (v, field, min, max) => {
  if (!Array.isArray(v)) bad(field, "목록이어야 해");
  if (v.length < min || v.length > max) bad(field, min === max ? `${min}개여야 해` : `${min}~${max}개`);
  return v;
};
const int = (v, field, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(field, `${min}~${max} 사이 정수`);
  return n;
};

const ID_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;
const IMG_RE = /^[a-f0-9]{24}$/;

function food(input) {
  if (!input || typeof input !== "object") bad("data", "음식 정보가 없어");
  const f = {};
  f.id = String(input.id || "").trim();
  if (!ID_RE.test(f.id)) bad("id", "영문 소문자·숫자·- 2~24자 (예: dzk, honey-chip)");
  f.year = int(input.year, "year", 2000, 2100);
  f.name = plain(input.name, "name", 40);
  f.sub = plain(input.sub, "sub", 80, { required: false });
  f.icon = String(input.icon || "").trim();
  if (f.icon.startsWith("img:")) { if (!IMG_RE.test(f.icon.slice(4))) bad("icon", "사진 아이콘 번호가 잘못됐어"); }
  else if (f.icon.startsWith("emoji:")) {
    const e = f.icon.slice(6);
    // 이모지 1개(피부색·결합 문자 포함). 글자·숫자·기호는 막음
    if (!e || e.length > 16 || /[\s<>"'`&]/.test(e) || !/\p{Extended_Pictographic}/u.test(e) || /[\p{L}\p{N}]/u.test(e)) bad("icon", "이모지 하나만 넣어줘 (예: 🍩)");
  }
  else if (ICONS.size && !ICONS.has(f.icon)) bad("icon", "목록에 있는 아이콘을 골라줘");
  f.hints = arr(input.hints, "hints", 3, 3).map((h, i) => {
    if (!Array.isArray(h)) bad(`hints.${i}`, "형식 오류");
    return [rich(h[0], `hints.${i}.0`, 200), rich(h[1], `hints.${i}.1`, 140, { required: false })];
  });
  f.desc = rich(input.desc, "desc", 200);
  f.tags = arr(input.tags || [], "tags", 0, 8).map((t, i) => plain(t, `tags.${i}`, 24));
  f.remember = rich(input.remember, "remember", 1200);
  const head = input.head || {};
  f.head = { t: rich(head.t, "head.t", 200), m: plain(head.m, "head.m", 80) };
  if (head.sum) f.head.sum = true;
  f.stats = arr(input.stats || [], "stats", 0, 4).map((s, i) => {
    if (!Array.isArray(s)) bad(`stats.${i}`, "형식 오류");
    const row = [label(s[0], `stats.${i}.0`, 60), plain(s[1], `stats.${i}.1`, 24), int(s[2] ?? i % 3, `stats.${i}.2`, 0, 2)];
    if (s[3]) row.push(1);
    return row;
  });
  f.note = rich(input.note, "note", 800, { required: false });
  f.why = arr(input.why || [], "why", 1, 6).map((w, i) => rich(w, `why.${i}`, 400));
  const now = input.now || {};
  f.now = { when: plain(now.when, "now.when", 40), t: rich(now.t, "now.t", 1200) };
  f.src = arr(input.src || [], "src", 1, 12).map((s, i) => {
    if (!Array.isArray(s)) bad(`src.${i}`, "형식 오류");
    return [plain(s[0], `src.${i}.0`, 80), url(s[1], `src.${i}.1`)];
  });
  if (input.photo && input.photo.id) {
    const p = input.photo;
    if (!IMG_RE.test(String(p.id))) bad("photo.id", "사진 번호가 잘못됐어");
    f.photo = { id: String(p.id), alt: plain(p.alt, "photo.alt", 120), credit: plain(p.credit, "photo.credit", 120) };
    if (p.url) f.photo.url = url(p.url, "photo.url");
  }
  if (Array.isArray(input.hintsAlt)) f.hintsAlt = input.hintsAlt.slice(0, 3).map((h, i) => [rich(h && h[0], `hintsAlt.${i}.0`, 200, { required: false }), rich(h && h[1], `hintsAlt.${i}.1`, 140, { required: false })]);
  if (input.verb) f.verb = plain(input.verb, "verb", 8);
  if (input.ord != null && input.ord !== "") f.ord = int(input.ord, "ord", 0, 9999); // 같은 해 안에서 보이는 순서
  return f;
}

function receipt(input) {
  if (!input || typeof input !== "object") bad("receipt", "영수증 정보가 없어");
  const clientId = String(input.clientId || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clientId)) bad("clientId", "형식 오류");
  const r = input.receipt || {};
  const items = arr(r.items || [], "items", 0, 200).map((x, i) => {
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
      rank: r.rank ? plain(String(r.rank), "rank", 30) : null,
      ate: int(r.ate ?? items.filter(x => x.ate === "y").length, "ate", 0, 1000),
    },
  };
}

module.exports = { food, receipt, ID_RE, IMG_RE, ICONS };
