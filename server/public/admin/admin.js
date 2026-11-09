/* 먹어봤.zip 관리자 페이지 */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brToNl = s => String(s ?? "").replace(/<br\s*\/?>/gi, "\n");
const clone = o => JSON.parse(JSON.stringify(o));
const fmtDate = t => t ? new Date(t).toLocaleString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const FOLDER_YEARS = [2014, 2016, 2018, 2020, 2022, 2024, 2026]; // 사이트에 폴더가 있는 해 (index.html의 FOOD_YEARS와 같게)

let ME = null, ICONS = [], FOODS = [], dirty = false;

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = err ? "err" : ""; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2600);
}

async function api(method, path, body) {
  const opt = { method, headers: {}, credentials: "same-origin" };
  if (method !== "GET") opt.headers["X-MGB-Admin"] = "1";
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch (e) { throw Object.assign(new Error("서버에 연결할 수 없어. 잠시 뒤 다시 해줘"), { net: true }); }
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  if (res.status === 401 && path !== "/api/admin/login") { ME = null; render(); throw new Error("로그인이 풀렸어. 다시 로그인해줘"); }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `오류 (${res.status})`), { field: data && data.field, status: res.status });
  return data;
}

const icon = (name, cls = "") => name && name.startsWith("emoji:")
  ? `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-size="72">${esc(name.slice(6))}</text></svg>`
  : name && name.startsWith("img:")
  ? `<img class="${cls}" src="/api/images/${esc(name.slice(4))}?v=thumb" alt="">`
  : `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="icons.svg#${esc(name)}"></use></svg>`;

/* ---------------- 화면 전환 ---------------- */
const route = () => decodeURIComponent(location.hash.slice(1)) || "foods";
window.addEventListener("hashchange", () => render());
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
function go(h) {
  if (dirty && !confirm("저장하지 않은 내용이 있어. 이동할까?")) return;
  dirty = false;
  if (location.hash.slice(1) === h) render(); else location.hash = h;
}

function shell(active, inner) {
  const tabs = [["foods", "음식"], ["receipts", "영수증"], ["images", "사진"], ["accounts", "계정"]];
  return `<header class="bar"><div class="bar-in">
    <div class="logo">먹어봤<em>.zip</em><small>관리자</small></div>
    <nav class="nav" aria-label="관리 메뉴">${tabs.map(([k, n]) => `<button data-go="${k}" ${active === k ? 'aria-current="page"' : ""}>${n}</button>`).join("")}</nav>
    <div class="who"><span>${esc(ME.username)}</span><button class="btn sm ghost" id="logout">로그아웃</button></div>
  </div></header><main class="wrap">${inner}</main>`;
}
function bindShell() {
  $$("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  $("#logout").onclick = async () => { await api("POST", "/api/admin/logout", {}).catch(() => {}); ME = null; dirty = false; render(); };
}

async function render() {
  if (!ME) {
    try { const r = await api("GET", "/api/admin/me"); ME = r.admin; if (!ME) return loginView(r.hasAdmins); }
    catch (e) { app.innerHTML = `<div class="login"><div class="card"><h1>연결 실패</h1><p class="lead">${esc(e.message)}</p><button class="btn p" id="retry">다시 시도</button></div></div>`; $("#retry").onclick = () => location.reload(); return; }
  }
  if (!ICONS.length) await loadIcons();
  const r = route();
  window.scrollTo(0, 0);
  if (r === "foods") return foodsView();
  if (r === "new") return editView(null);
  if (r.startsWith("food/")) return editView(r.slice(5));
  if (r === "receipts") return receiptsView();
  if (r === "images") return imagesView();
  if (r === "accounts") return accountsView();
  location.hash = "foods";
}

async function loadIcons() {
  try { const t = await (await fetch("icons.svg")).text(); ICONS = [...t.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]); } catch (e) { ICONS = []; }
}

/* ---------------- 로그인 ---------------- */
function loginView(hasAdmins) {
  app.innerHTML = `<div class="login"><form class="card" id="lf" novalidate>
    <h1>먹어봤<span style="color:var(--acc)">.zip</span></h1><p class="lead">팀 관리자 로그인</p>
    ${hasAdmins ? "" : `<p class="notice" style="margin:0 0 14px">아직 관리자 계정이 없어. 서버 환경변수에 ADMIN_USERNAME과 ADMIN_PASSWORD를 넣고 서버를 다시 켜줘.</p>`}
    <div class="stack" style="display:flex;flex-direction:column;gap:12px">
      <label class="f"><span>아이디</span><input name="username" autocomplete="username" required></label>
      <label class="f"><span>비밀번호</span><input name="password" type="password" autocomplete="current-password" required></label>
      <p class="f err" id="lerr" role="alert" style="margin:0"></p>
      <button class="btn p" type="submit">로그인</button>
    </div></form></div>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), b = $("button", e.target);
    b.disabled = true; $("#lerr").textContent = "";
    try { const r = await api("POST", "/api/admin/login", { username: fd.get("username"), password: fd.get("password") }); ME = { username: r.username }; ME = (await api("GET", "/api/admin/me")).admin; render(); }
    catch (err) { $("#lerr").textContent = err.message; b.disabled = false; }
  };
  $("input", app).focus();
}

/* ---------------- 음식 목록 ---------------- */
async function foodsView() {
  app.innerHTML = shell("foods", `<h1>음식</h1><p class="lead">퀴즈 힌트, 설명, 기사, 사진을 고치거나 새 음식을 추가해. 저장하면 사이트에 바로 반영돼(방문자 화면은 최대 몇 분 뒤).</p><div class="empty">불러오는 중…</div>`);
  bindShell();
  try { FOODS = (await api("GET", "/api/admin/foods")).foods; } catch (e) { $(".empty").textContent = e.message; return; }
  const years = [...new Set(FOODS.map(f => f.year))].sort((a, b) => b - a);
  $("main").innerHTML = `<div class="ed-head"><h1>음식 <small class="mono" style="font-size:14px;color:var(--mute)">${FOODS.length}개</small></h1><button class="btn p" id="add">+ 새 음식</button></div>
    <p class="lead">퀴즈 힌트, 설명, 기사, 사진을 고치거나 새 음식을 추가해. 저장하면 사이트에 반영돼.</p>
    <div class="tools"><input class="in" id="q" type="search" placeholder="이름·id 검색" aria-label="검색">
      <select class="in" id="yf" aria-label="연도"><option value="">모든 해</option>${years.map(y => `<option>${y}</option>`).join("")}</select>
      <select class="in" id="pf" aria-label="공개 여부"><option value="">전체</option><option value="1">공개</option><option value="0">숨김</option></select></div>
    <div class="flist" id="fl"></div>`;
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase(), y = $("#yf").value, p = $("#pf").value;
    const list = FOODS.filter(f => (!q || (f.name + f.id + (f.sub || "")).toLowerCase().includes(q)) && (!y || String(f.year) === y) && (!p || String(+f._published) === p));
    let last = null, html = "";
    for (const f of list) {
      if (f.year !== last) { last = f.year; html += `<div class="yearhead">${f.year}${FOLDER_YEARS.includes(f.year) ? "" : " · 사이트에 폴더 없는 해"}</div>`; }
      html += `<button class="fitem" data-id="${esc(f.id)}"><span class="ic">${icon(f.icon)}</span><span><b>${esc(f.name)}</b>
        <span class="meta"><span class="mono">${esc(f.id)}</span>${f._published ? '<span class="pill on">공개</span>' : '<span class="pill off">숨김</span>'}${f.photo ? '<span class="pill">사진</span>' : ""}</span></span></button>`;
    }
    $("#fl").innerHTML = html || `<div class="empty" style="grid-column:1/-1">맞는 음식이 없어</div>`;
    $$(".fitem").forEach(b => b.onclick = () => go("food/" + b.dataset.id));
  };
  ["q", "yf", "pf"].forEach(id => $("#" + id).addEventListener("input", draw));
  $("#add").onclick = () => go("new");
  draw();
}

/* ---------------- 음식 편집 ---------------- */
const BLANK = () => ({ id: "", year: 2026, name: "", sub: "", icon: ICONS.includes("cookie") ? "cookie" : ICONS[0], hints: [["", ""], ["", ""], ["", ""]], desc: "", tags: [], remember: "", head: { t: "", m: "" }, stats: [["", "", 0]], note: "", why: [""], now: { when: "", t: "" }, src: [["", ""]] });
const RICH = ["hints", "desc", "remember", "head.t", "note", "why", "now.t", "stats"]; // <br> ↔ 줄바꿈으로 편집

function getPath(o, p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach((k, i) => { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }

async function editView(id) {
  const isNew = !id;
  app.innerHTML = shell("foods", `<div class="empty">불러오는 중…</div>`); bindShell();
  let F, meta = { published: true, updatedAt: null, updatedBy: null };
  if (isNew) F = BLANK();
  else {
    try { const r = await api("GET", "/api/admin/foods/" + encodeURIComponent(id)); F = r.food; meta = r; }
    catch (e) { $("main").innerHTML = `<div class="empty">${esc(e.message)}<br><br><button class="btn" data-go="foods">목록으로</button></div>`; bindShell(); return; }
  }
  // 편집용: <br> → 줄바꿈
  const toEdit = v => typeof v === "string" ? brToNl(v) : Array.isArray(v) ? v.map(toEdit) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toEdit(x)])) : v;
  F = toEdit(F);
  F.tagsText = (F.tags || []).join(", ");
  let published = meta.published;
  const start = JSON.stringify([F, published]);
  const markDirty = () => { dirty = JSON.stringify([F, published]) !== start; const m = $("#smsg"); if (m) { m.textContent = dirty ? "저장하지 않은 변경이 있어" : meta.updatedAt ? `마지막 저장 ${fmtDate(meta.updatedAt)} · ${meta.updatedBy || ""}` : "아직 저장 안 함"; m.classList.toggle("dirty", dirty); } };

  const inp = (path, label, { area = false, max = 0, ph = "", note = "", type = "text", ro = false } = {}) => {
    const v = getPath(F, path) ?? "";
    const ctrl = area ? `<textarea data-p="${path}" rows="${area === true ? 3 : area}" placeholder="${esc(ph)}" ${max ? `maxlength="${max + 200}"` : ""}>${esc(v)}</textarea>`
      : `<input data-p="${path}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}" ${ro ? "readonly" : ""} ${type === "url" ? 'inputmode="url"' : ""}>`;
    return `<label class="f" data-f="${path}"><span>${label}${note ? `<small>${note}</small>` : ""}</span>${ctrl}<span class="err" hidden></span></label>`;
  };

  const sections = () => `
  <div class="ed-head"><button class="btn sm ghost" data-go="foods">← 목록</button><h1>${isNew ? "새 음식" : esc(F.name || F.id)}</h1>
    ${isNew ? "" : `<span class="pill ${published ? "on" : "off"}">${published ? "사이트에 공개" : "숨김"}</span>`}</div>

  <section class="sec"><h2>기본 정보</h2><p class="hint">id는 주소와 기록에 쓰여서 만든 뒤엔 바꿀 수 없어.</p><div class="stack">
    <div class="grid3">${inp("id", "id", { ph: "예: honey-chip", ro: !isNew, note: "영문 소문자·숫자·-" })}
      ${inp("year", "유행한 해", { type: "number", note: FOLDER_YEARS.includes(+F.year) ? "" : "사이트 폴더가 있는 해: " + FOLDER_YEARS.join("·") })}
      <label class="chk" style="align-self:end"><input type="checkbox" id="pub" ${published ? "checked" : ""}> 사이트에 공개</label></div>
    <div class="grid3">${inp("ord", "같은 해 안 순서", { type: "number", note: "작을수록 폴더 위쪽 · 비우면 맨 뒤" })}</div>
    <div class="grid2">${inp("name", "음식 이름 (퀴즈 정답)", { ph: "허니버터칩" })}${inp("sub", "부제", { ph: "해태제과 감자칩" })}</div>
    <div class="f" data-f="icon"><span>아이콘 <small>그림을 고르거나, 이모지를 넣거나, 아이콘 이미지를 직접 올려</small></span>
      <div class="icon-add">
        <label class="emoji-in"><span>이모지</span><input id="emoji" maxlength="16" placeholder="🍡" aria-label="이모지 입력" value="${F.icon && F.icon.startsWith("emoji:") ? esc(F.icon.slice(6)) : ""}"><button class="btn sm" type="button" id="useEmoji">적용</button></label>
        <button class="btn sm" type="button" id="iconUp">아이콘 이미지 올리기</button><input type="file" id="iconFile" accept="image/png,image/webp,image/jpeg" hidden>
        <small class="icon-tip">배경이 투명한 PNG가 가장 예뻐. 정사각형으로 맞춰서 저장돼.</small>
      </div>
      <div class="icons" id="icons" role="group" aria-label="아이콘 고르기">${(F.icon && (F.icon.startsWith("img:") || F.icon.startsWith("emoji:")) ? [F.icon] : []).concat(ICONS).map(n => `<button type="button" data-icon="${esc(n)}" aria-pressed="${n === F.icon}" title="${esc(n)}">${icon(n)}</button>`).join("")}</div><span class="err" hidden></span></div>
  </div></section>

  <section class="sec"><h2>퀴즈 힌트</h2><p class="hint">방문자는 힌트 1부터 하나씩 열어. 1이 가장 어렵고 3이 가장 쉽게. 오른쪽은 작게 붙는 보조 문구야.</p><div class="stack">
    ${[0, 1, 2].map(i => `<div class="hintrow"><span class="no">${i + 1}</span>${inp(`hints.${i}.0`, `힌트 ${i + 1}`, { area: 2 })}${inp(`hints.${i}.1`, "보조 문구", { area: 2, note: "선택" })}</div>`).join("")}
    <div class="grid2">${inp("desc", "정답 공개 때 한 줄 설명", { area: 2 })}${inp("tagsText", "태그", { note: "쉼표로 구분" })}</div>
  </div></section>

  <section class="sec"><h2><span class="tab">기억나?</span> 설명과 사진</h2><p class="hint">기록 화면 첫 탭. 줄을 바꾸면 사이트에서도 줄이 바뀌고, &lt;b&gt;굵게&lt;/b&gt;도 쓸 수 있어.</p><div class="stack">
    ${inp("remember", "설명", { area: 5 })}
    <div class="photo"><div><div class="drop" id="drop" tabindex="0" role="button" aria-label="사진 올리기">${F.photo ? `<img src="/api/images/${esc(F.photo.id)}" alt="">` : "사진을 끌어 놓거나<br>눌러서 고르기"}</div>
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="row" style="margin-top:8px">${F.photo ? `<button class="btn sm ghost" type="button" id="asIcon">이 사진을 아이콘으로</button><button class="btn sm danger" type="button" id="rmPhoto">사진 빼기</button>` : ""}</div></div>
      <div class="stack" style="display:flex;flex-direction:column;gap:12px">
        ${F.photo ? `${inp("photo.alt", "사진 설명 (화면 낭독용)", { ph: "노란 봉지에 든 감자칩" })}${inp("photo.credit", "사진 출처·저작권", { ph: "팀 직접 촬영 / 해태제과 제공" })}${inp("photo.url", "출처 링크", { type: "url", note: "선택" })}` : ""}
        <p class="notice">뉴스 기사나 다른 사이트의 사진은 저작권이 있어서 허락 없이 쓰면 안 돼. 직접 찍은 사진, 회사 보도자료 사진(출처 표기), 자유 이용 사진을 써줘. 사진은 올릴 때 자동으로 줄여서 저장돼.</p>
      </div></div>
  </div></section>

  <section class="sec"><h2><span class="tab">얼마나 인기?</span> 기사 스크랩과 숫자</h2><p class="hint">기사 제목은 '출처' 목록에서 매체 이름이 같은 기사로 자동 연결돼.</p><div class="stack">
    <div class="grid2">${inp("head.t", "기사 제목", { area: 2 })}<div class="stack" style="display:flex;flex-direction:column;gap:10px">${inp("head.m", "매체 · 날짜", { ph: "헤럴드경제 · 2026.01.15" })}<label class="chk"><input type="checkbox" id="hsum" ${F.head && F.head.sum ? "checked" : ""}> 여러 기사를 요약한 제목이야</label></div></div>
    <div><div class="row" style="margin-bottom:8px"><b style="font-size:13px">숫자 카드</b><small style="color:var(--mute)">최대 4개 · 이름에서 줄을 바꾸면 카드에서도 바뀜</small><span class="spacer"></span><button class="btn sm" type="button" data-add="stats">+ 추가</button></div>
      <div class="list-ed" id="l-stats">${(F.stats || []).map((s, i) => `<div class="li stat">${inp(`stats.${i}.0`, "이름", { area: 2 })}${inp(`stats.${i}.1`, "숫자", { ph: "+321%" })}
        <label class="f"><span>색</span><select data-p="stats.${i}.2" data-num="1">${["주황", "파랑", "초록"].map((c, k) => `<option value="${k}" ${+s[2] === k ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="chk"><input type="checkbox" data-wide="${i}" ${s[3] ? "checked" : ""}> 넓게</label><button class="rm" type="button" data-rm="stats.${i}" aria-label="숫자 카드 ${i + 1} 지우기">×</button></div>`).join("")}</div></div>
    ${inp("note", "덧붙이는 말", { area: 3, note: "선택" })}
  </div></section>

  <section class="sec"><h2><span class="tab">왜 유행?</span> 유행한 이유</h2><p class="hint">번호 매긴 목록으로 보여. 1~6개.</p>
    <div class="list-ed" id="l-why">${(F.why || []).map((w, i) => `<div class="li why">${inp(`why.${i}`, `이유 ${i + 1}`, { area: 2 })}<button class="rm" type="button" data-rm="why.${i}" aria-label="이유 ${i + 1} 지우기">×</button></div>`).join("")}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" type="button" data-add="why">+ 이유 추가</button></div></section>

  <section class="sec"><h2><span class="tab">지금은?</span> 유행 뒤 이야기</h2><div class="stack" style="margin-top:12px">
    ${inp("now.when", "언제 기준", { ph: "2026년 1월" })}${inp("now.t", "내용", { area: 4 })}</div></section>

  <section class="sec"><h2>출처 (뉴스 기사)</h2><p class="hint">'지금은?' 탭 아래에 링크로 나와. 이름은 "매체, 날짜" 형식(예: 헤럴드경제, 2026.1.15)으로 써야 기사 스크랩과 자동 연결돼.</p>
    <div class="list-ed" id="l-src">${(F.src || []).map((s, i) => `<div class="li src">${inp(`src.${i}.0`, "매체, 날짜", { ph: "헤럴드경제, 2026.1.15" })}${inp(`src.${i}.1`, "기사 주소", { type: "url", ph: "https://" })}<button class="rm" type="button" data-rm="src.${i}" aria-label="출처 ${i + 1} 지우기">×</button></div>`).join("")}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" type="button" data-add="src">+ 기사 추가</button></div></section>

  ${isNew ? "" : `<section class="sec"><h2>지우기</h2><p class="hint">사이트에서만 빼려면 위의 '사이트에 공개'를 끄는 게 좋아. 지우면 되돌릴 수 없어.</p><button class="btn danger" type="button" id="del">이 음식 지우기</button></section>`}
  <div class="savebar"><div class="in"><span class="msg" id="smsg"></span><button class="btn ghost" type="button" data-go="foods">취소</button><button class="btn p" type="button" id="save">${isNew ? "만들기" : "저장"}</button></div></div>`;

  const draw = () => {
    const y = window.scrollY;
    $("main").innerHTML = sections(); bindShell(); bind(); markDirty();
    window.scrollTo(0, y);
  };
  const bind = () => {
    $$("[data-p]").forEach(el => el.addEventListener("input", () => {
      const v = el.dataset.num ? Number(el.value) : el.value;
      setPath(F, el.dataset.p, el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : v);
      el.closest(".f")?.classList.remove("bad"); const er = el.closest(".f")?.querySelector(".err"); if (er) er.hidden = true;
      markDirty();
    }));
    $("#pub").onchange = e => { published = e.target.checked; markDirty(); };
    $("#hsum").onchange = e => { F.head = F.head || {}; if (e.target.checked) F.head.sum = true; else delete F.head.sum; markDirty(); };
    $$("[data-wide]").forEach(c => c.onchange = () => { const s = F.stats[+c.dataset.wide]; if (c.checked) s[3] = 1; else s.length = 3; markDirty(); });
    $$("[data-icon]").forEach(b => b.onclick = () => { F.icon = b.dataset.icon; $$("[data-icon]").forEach(x => x.setAttribute("aria-pressed", x === b)); markDirty(); });
    // 이모지 아이콘
    const useEmoji = () => {
      const v = $("#emoji").value.trim();
      const seg = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(v)].map(x => x.segment) : [v];
      if (!v || seg.length !== 1 || !/\p{Extended_Pictographic}/u.test(v)) return toast("이모지 하나만 넣어줘 (예: 🍩)", true);
      F.icon = "emoji:" + v; draw(); toast("이모지를 아이콘으로 정했어");
    };
    $("#useEmoji").onclick = useEmoji;
    $("#emoji").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); useEmoji(); } };
    // 아이콘 이미지 올리기 (사진과 별개)
    $("#iconUp").onclick = () => $("#iconFile").click();
    $("#iconFile").onchange = async () => {
      const f = $("#iconFile").files[0]; if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast("PNG·WebP·JPG만 올릴 수 있어", true);
      const b = $("#iconUp"); b.disabled = true; b.textContent = "올리는 중…";
      try {
        const { full, thumb, width, height } = await shrinkIcon(f);
        const r = await api("POST", "/api/admin/images", { full, thumb, width, height });
        F.icon = "img:" + r.id; draw(); toast("아이콘 이미지를 정했어. 저장을 눌러줘");
      } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "아이콘 이미지 올리기"; }
    };
    $$("[data-add]").forEach(b => b.onclick = () => {
      const k = b.dataset.add, lim = { stats: 4, why: 6, src: 12 }[k];
      F[k] = F[k] || [];
      if (F[k].length >= lim) return toast(`최대 ${lim}개까지야`, true);
      F[k].push(k === "stats" ? ["", "", F[k].length % 3] : k === "src" ? ["", ""] : "");
      draw();
    });
    $$("[data-rm]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split("."); F[k].splice(+i, 1); draw(); });
    // 사진
    const drop = $("#drop"), file = $("#file");
    drop.onclick = () => file.click();
    drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); };
    file.onchange = () => { if (file.files[0]) upload(file.files[0]); };
    if ($("#rmPhoto")) $("#rmPhoto").onclick = () => { if (F.icon === "img:" + F.photo.id) F.icon = ICONS.includes("cookie") ? "cookie" : ICONS[0]; delete F.photo; draw(); };
    if ($("#asIcon")) $("#asIcon").onclick = () => { F.icon = "img:" + F.photo.id; draw(); toast("사진을 아이콘으로 정했어"); };
    $("#save").onclick = save;
    if ($("#del")) $("#del").onclick = async e => {
      const b = e.currentTarget;
      if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "정말 지울까? 한 번 더 누르면 지워져"; setTimeout(() => { delete b.dataset.c; b.textContent = "이 음식 지우기"; }, 4000); return; }
      try { await api("DELETE", "/api/admin/foods/" + encodeURIComponent(F.id)); dirty = false; toast("지웠어"); go("foods"); } catch (err) { toast(err.message, true); }
    };
  };
  async function upload(f) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast("JPG·PNG·WebP 사진만 올릴 수 있어", true);
    const drop = $("#drop"); drop.textContent = "사진 줄이는 중…";
    try {
      const { full, thumb, width, height } = await shrink(f);
      drop.textContent = "올리는 중…";
      const r = await api("POST", "/api/admin/images", { full, thumb, width, height });
      F.photo = { id: r.id, alt: (F.photo && F.photo.alt) || "", credit: (F.photo && F.photo.credit) || "" };
      draw(); toast("사진을 올렸어. 출처를 꼭 적고 저장해줘");
    } catch (e) { toast(e.message, true); draw(); }
  }
  async function save() {
    const b = $("#save"); b.disabled = true;
    $$(".f.bad").forEach(x => x.classList.remove("bad"));
    const food = clone(F);
    food.tags = String(F.tagsText || "").split(/[,，]/).map(s => s.trim().replace(/^#/, "")).filter(Boolean);
    delete food.tagsText;
    food.year = Number(food.year);
    if (food.ord === "" || food.ord == null) delete food.ord; else food.ord = Number(food.ord);
    if (food.photo && !food.photo.url) delete food.photo.url;
    try {
      const r = isNew ? await api("POST", "/api/admin/foods", { food, published })
        : await api("PUT", "/api/admin/foods/" + encodeURIComponent(F.id), { food, published, updatedAt: meta.updatedAt });
      dirty = false; toast(isNew ? "만들었어" : "저장했어");
      if (isNew) location.hash = "food/" + r.food.id; else editView(F.id);
    } catch (e) {
      b.disabled = false;
      toast(e.message, true);
      if (e.field) {
        const p = e.field.replace(/^tags\..*/, "tagsText");
        const box = $(`[data-f="${CSS.escape(p)}"]`) || $(`[data-f="${CSS.escape(p.replace(/\.\d+$/, ""))}"]`);
        if (box) { box.classList.add("bad"); const er = $(".err", box); if (er) { er.textContent = e.message.replace(/^[^:]+:\s*/, ""); er.hidden = false; } box.scrollIntoView({ block: "center", behavior: "smooth" }); $("input,textarea,select", box)?.focus({ preventScroll: true }); }
      }
    }
  }
  draw();
}

// 사진 줄이기: 큰 사진은 긴 변 1280px, 작은 사진은 320px 정사각형
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement("canvas"), cx = cv.getContext("2d");
  const webp = cv.toDataURL("image/webp").startsWith("data:image/webp");
  const type = webp ? "image/webp" : "image/jpeg";
  const toB64 = async () => { const blob = await new Promise(r => cv.toBlob(r, type, .84)); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const full = await toB64(), width = cv.width, height = cv.height;
  const side = Math.min(bmp.width, bmp.height);
  cv.width = cv.height = 320;
  cx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 320, 320);
  const thumb = await toB64();
  return { full, thumb, width, height };
}

// 아이콘용: 자르지 않고 정사각형 안에 맞춤, 투명 배경 유지
async function shrinkIcon(file) {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement("canvas"), cx = cv.getContext("2d");
  const webp = cv.toDataURL("image/webp").startsWith("data:image/webp");
  const type = webp ? "image/webp" : "image/png";
  const toB64 = async () => { const blob = await new Promise(r => cv.toBlob(r, type, .9)); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
  const draw = n => { cv.width = cv.height = n; cx.clearRect(0, 0, n, n); const k = n / Math.max(bmp.width, bmp.height), w = bmp.width * k, h = bmp.height * k; cx.drawImage(bmp, (n - w) / 2, (n - h) / 2, w, h); };
  draw(512); const full = await toB64();
  draw(320); const thumb = await toB64();
  return { full, thumb, width: 512, height: 512 };
}

/* ---------------- 영수증 ---------------- */
async function receiptsView() {
  app.innerHTML = shell("receipts", `<h1>영수증</h1><p class="lead">방문자가 뽑은 영수증을 모은 통계야. 이름·서명은 저장하지 않아.</p><div class="empty">불러오는 중…</div>`); bindShell();
  let st, list;
  try { [st, list] = await Promise.all([api("GET", "/api/admin/receipts/stats"), api("GET", "/api/admin/receipts?limit=50")]); }
  catch (e) { $(".empty").textContent = e.message; return; }
  const pct = v => v == null ? "-" : Math.round(v * 100) + "%";
  const sec = ms => ms == null ? "-" : ms < 60000 ? Math.round(ms / 1000) + "초" : Math.floor(ms / 60000) + "분 " + Math.round(ms % 60000 / 1000) + "초";
  const maxRank = Math.max(1, ...st.ranks.map(r => r[1]));
  $("main").innerHTML = `<div class="ed-head"><h1>영수증</h1><a class="btn" href="/api/admin/receipts.csv" download>CSV로 내려받기</a></div>
    <p class="lead">방문자가 뽑은 영수증을 모은 통계야. 같은 방문자가 다시 뽑으면 최신 것으로 바뀌고, 이름·서명은 저장하지 않아.</p>
    <div class="kpis"><div class="kpi"><small>영수증 뽑은 방문자</small><b>${st.visitors}</b></div><div class="kpi"><small>최근 7일</small><b>${st.lastWeek}</b></div>
      <div class="kpi"><small>평균 열어본 파일</small><b>${st.avgOpened.toFixed(1)}</b></div><div class="kpi"><small>평균 유행 민감도</small><b>${st.avgSens == null ? "-" : Math.round(st.avgSens)}</b></div></div>
    ${st.visitors ? `<div class="grid2" style="margin-bottom:14px"><div class="card"><h2 style="font-size:16px;margin:0 0 12px">칭호 분포</h2><div class="bars">${st.ranks.map(([n, c]) => `<div><span>${esc(n)}</span><i style="width:${c / maxRank * 100}%"></i><span>${c}</span></div>`).join("") || '<p class="empty">아직 없어</p>'}</div></div>
      <div class="card"><h2 style="font-size:16px;margin:0 0 12px">가장 많이 연 음식</h2><div class="bars">${st.foods.slice(0, 6).map(f => `<div><span>${esc(f.name)}</span><i style="width:${f.opened / st.foods[0].opened * 100}%"></i><span>${f.opened}</span></div>`).join("")}</div></div></div>
    <div class="card" style="margin-bottom:14px"><h2 style="font-size:16px;margin:0 0 10px">음식별 퀴즈 결과</h2><div class="scroll"><table class="tbl"><thead><tr><th>음식</th><th class="num">연 사람</th><th class="num">정답률</th><th class="num">힌트 없이 정답</th><th class="num">평균 본 힌트</th><th class="num">먹어봤다</th><th class="num">평균 시간</th></tr></thead>
      <tbody>${st.foods.map(f => `<tr><td>${esc(f.name)}</td><td class="num">${f.opened}</td><td class="num">${pct(f.solveRate)}</td><td class="num">${pct(f.noHintRate)}</td><td class="num">${f.avgHints.toFixed(1)}</td><td class="num">${pct(f.ateRate)}</td><td class="num">${sec(f.avgMs)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="card"><h2 style="font-size:16px;margin:0 0 10px">최근 영수증 <small style="color:var(--mute);font-weight:500">${list.total}개 중 ${list.receipts.length}개</small></h2><div class="scroll"><table class="tbl"><thead><tr><th>마지막 저장</th><th class="num">열어본 파일</th><th class="num">먹어본 음식</th><th class="num">민감도</th><th>칭호</th></tr></thead>
      <tbody>${list.receipts.map(x => `<tr><td>${fmtDate(x.updated_at)}</td><td class="num">${x.opened} / ${x.total}</td><td class="num">${x.data.ate ?? "-"}</td><td class="num">${x.sens ?? "-"}</td><td>${esc(x.rank || "-")}</td></tr>`).join("")}</tbody></table></div></div>`
    : `<div class="card empty">아직 저장된 영수증이 없어. 사이트에서 영수증 화면을 열면 여기에 쌓여.</div>`}`;
  bindShell();
}

/* ---------------- 사진 ---------------- */
async function imagesView() {
  app.innerHTML = shell("images", `<h1>사진</h1><div class="empty">불러오는 중…</div>`); bindShell();
  let r; try { r = await api("GET", "/api/admin/images"); } catch (e) { $(".empty").textContent = e.message; return; }
  const unused = r.images.filter(i => !i.usedBy).length;
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.round(n / 1024) + "KB";
  $("main").innerHTML = `<div class="ed-head"><h1>사진 <small class="mono" style="font-size:14px;color:var(--mute)">${r.images.length}장</small></h1><button class="btn" id="clean" ${unused ? "" : "disabled"}>안 쓰는 사진 ${unused}장 정리</button></div>
    <p class="lead">사진은 음식 편집 화면에서 올려. 여기서는 올린 사진과 쓰이는 곳을 볼 수 있어. 정리는 올린 지 1시간 넘은 안 쓰는 사진만 지워.</p>
    ${r.images.length ? `<div class="imgs">${r.images.map(i => `<figure><img src="/api/images/${esc(i.id)}?v=thumb" alt="" loading="lazy"><figcaption>${i.usedBy ? `<a href="#food/${esc(i.usedBy)}">${esc(i.usedBy)}</a>` : '<span class="pill off">안 씀</span>'} · ${kb(i.size)}<br>${fmtDate(i.created_at)} · ${esc(i.created_by || "")}</figcaption></figure>`).join("")}</div>` : `<div class="card empty">아직 올린 사진이 없어</div>`}`;
  bindShell();
  $("#clean").onclick = async () => { try { const x = await api("POST", "/api/admin/images/cleanup", {}); toast(`${x.deleted}장 정리했어`); imagesView(); } catch (e) { toast(e.message, true); } };
}

/* ---------------- 계정 ---------------- */
async function accountsView() {
  app.innerHTML = shell("accounts", `<h1>계정</h1><div class="empty">불러오는 중…</div>`); bindShell();
  let r; try { r = await api("GET", "/api/admin/admins"); } catch (e) { $(".empty").textContent = e.message; return; }
  $("main").innerHTML = `<h1>계정</h1><p class="lead">팀원 관리자 계정과 내 비밀번호, 데이터 백업.</p>
  <div class="grid2">
    <section class="sec"><h2>팀원 관리자</h2><p class="hint">관리자는 모두 같은 권한이야.</p>
      <table class="tbl" style="margin-bottom:14px"><tbody>${r.admins.map(a => `<tr><td><b>${esc(a.username)}</b>${a.username === ME.username ? ' <span class="pill">나</span>' : ""}</td><td>${fmtDate(a.created_at)}</td><td class="num">${a.username === ME.username ? "" : `<button class="btn sm danger" data-del="${a.id}" data-name="${esc(a.username)}">지우기</button>`}</td></tr>`).join("")}</tbody></table>
      <form id="addf" class="stack" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:14px">새 팀원 추가</b>
        <label class="f"><span>아이디</span><input name="username" autocomplete="off" required></label>
        <label class="f"><span>처음 비밀번호 <small>10자 이상 · 팀원에게 따로 전하고 바꾸게 해줘</small></span><input name="password" type="password" autocomplete="new-password" required></label>
        <button class="btn dark">추가</button></form></section>
    <div><section class="sec"><h2>내 비밀번호 바꾸기</h2><form id="pwf" class="stack" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <label class="f"><span>지금 비밀번호</span><input name="current" type="password" autocomplete="current-password" required></label>
        <label class="f"><span>새 비밀번호 <small>10자 이상</small></span><input name="password" type="password" autocomplete="new-password" required></label>
        <button class="btn dark">바꾸기</button></form></section>
      <section class="sec"><h2>백업</h2><p class="hint">음식 데이터 전체를 JSON 파일로 내려받아. 가끔 받아 두면 안전해.</p><a class="btn" href="/api/admin/export" download>음식 데이터 내려받기</a></section></div>
  </div>`;
  bindShell();
  $("#addf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); try { await api("POST", "/api/admin/admins", { username: fd.get("username"), password: fd.get("password") }); toast("팀원을 추가했어"); accountsView(); } catch (err) { toast(err.message, true); } };
  $("#pwf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); try { await api("PUT", "/api/admin/password", { current: fd.get("current"), password: fd.get("password") }); toast("비밀번호를 바꿨어"); e.target.reset(); } catch (err) { toast(err.message, true); } };
  $$("[data-del]").forEach(b => b.onclick = async () => {
    if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "정말?"; setTimeout(() => { delete b.dataset.c; b.textContent = "지우기"; }, 3000); return; }
    try { await api("DELETE", "/api/admin/admins/" + b.dataset.del); toast(`${b.dataset.name} 계정을 지웠어`); accountsView(); } catch (err) { toast(err.message, true); }
  });
}

render();
