// 음식 파일 DB 행을 화면에 쓰는 모양으로 바꾸는 함수들 (관리자 API와 사이트가 같이 씀)

const parse = (s, fallback) => {
  try {
    return s == null ? fallback : JSON.parse(s);
  } catch (e) {
    return fallback;
  }
};

export const DAY = 24 * 60 * 60 * 1000;
export const TRASH_DAYS = 30;

// 관리자 화면용: 모든 칸
export function toAdmin(r) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    subtitle: r.subtitle,
    body: r.body,
    cover: parse(r.cover, null),
    category: r.category,
    author: r.author,
    status: r.status,
    deleted_at: r.deleted_at,
    purge_at: r.deleted_at == null ? null : r.deleted_at + TRASH_DAYS * DAY,
    published_at: r.published_at,
    slug: r.slug,
    sources: parse(r.sources, []),
    ord: r.ord,
    data: parse(r.data, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
    version: r.version,
  };
}

// 사이트용 음식 파일: 지금 index.html의 FOODS 한 칸과 같은 모양
export function toFood(r) {
  const d = parse(r.data, {});
  const f = {
    id: r.slug, // 사이트의 음식 번호 = 고유 주소 (영수증·화면 주소 #quiz/번호가 이 값을 씀)
    year: Number(r.category),
    name: r.title,
    sub: r.subtitle,
    icon: d.icon,
    hints: d.hints || [],
    opts: d.opts || [],
    desc: d.desc || "",
    tags: d.tags || [],
    remember: r.body,
    head: d.head || { t: "", m: "" },
    stats: d.stats || [],
    note: d.note || "",
    why: d.why || [],
    now: d.now || { when: "", t: "" },
    src: parse(r.sources, []),
  };
  if (d.hintsAlt) f.hintsAlt = d.hintsAlt;
  if (d.verb) f.verb = d.verb;
  if (r.ord != null) f.ord = r.ord;
  const cover = parse(r.cover, null);
  if (cover) f.photo = cover; // 사이트의 photo {id, alt, credit, url}
  return f;
}

// 사이트 순서: 최신 해부터, 같은 해 안에서는 ord 순
export const sortFoods = (list) => list.sort((a, b) => b.year - a.year || (a.ord ?? 9999) - (b.ord ?? 9999));

// 음식 파일이 쓰는 이미지 번호들 (대표 이미지 + 사진 아이콘)
export function imageIdsOf(c) {
  const ids = [];
  if (c.cover && c.cover.id) ids.push(c.cover.id);
  const icon = c.data && c.data.icon;
  if (typeof icon === "string" && icon.startsWith("img:")) ids.push(icon.slice(4));
  return ids;
}

// 휴지통에서 완전히 지우기: 이 음식 파일에만 쓰인 이미지도 저장소·DB에서 같이 지움
export async function purgeContent(env, id) {
  const row = await env.DB.prepare("SELECT * FROM contents WHERE id = ?").bind(id).first();
  if (!row || row.deleted_at == null) return false; // 휴지통에 있는 것만 지움
  const { results: imgs } = await env.DB.prepare("SELECT id FROM images WHERE content_id = ?").bind(id).all();
  const ids = new Set([...imgs.map((x) => x.id), ...imageIdsOf(toAdmin(row))]);
  const removable = [];
  for (const imgId of ids) {
    // 다른 음식 파일이 같은 이미지를 쓰고 있으면 남겨 둠
    const other = await env.DB.prepare("SELECT 1 FROM contents WHERE id != ? AND (cover LIKE ? OR data LIKE ?) LIMIT 1")
      .bind(id, `%${imgId}%`, `%img:${imgId}%`)
      .first();
    if (!other) removable.push(imgId);
  }
  for (const imgId of removable) await env.STORAGE.delete("images/" + imgId);
  await env.DB.batch([
    ...removable.map((imgId) => env.DB.prepare("DELETE FROM images WHERE id = ?").bind(imgId)),
    env.DB.prepare("DELETE FROM contents WHERE id = ? AND deleted_at IS NOT NULL").bind(id),
  ]);
  return true;
}
