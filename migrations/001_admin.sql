-- 관리자 페이지용 DB 표 (design-admin.md 5장, 11/25 수정본: 음식 파일 전용)
-- 적용: joripspace db migrate --project mukubowzip --file migrations/001_admin.sql
-- 시각은 모두 밀리초 숫자(Date.now())로 저장한다.

-- 음식 파일 한 건. 퀴즈·설명 칸(icon, hints, opts …)은 data(JSON)에 넣는다.
CREATE TABLE IF NOT EXISTS contents (
  id           TEXT PRIMARY KEY,                 -- 관리자 화면 주소용 번호. 기존 음식은 dzk 등, 새 음식은 서버가 만듦
  type         TEXT NOT NULL DEFAULT 'food',     -- 지금은 food만 (나중에 문화 culture를 넣을 자리라 칸 제한은 서버 검사에서 함)
  title        TEXT NOT NULL,                    -- 음식 이름
  subtitle     TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',         -- remember (그 음식 설명)
  cover        TEXT,                             -- JSON {id, alt, credit, url} 또는 NULL
  category     TEXT NOT NULL DEFAULT '',         -- 연도 '2026' 등 (짝수 해만)
  author       TEXT NOT NULL DEFAULT '관리자',  -- 기록용. 사이트엔 안 보임
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  deleted_at   INTEGER,                          -- 비어 있으면 휴지통 아님
  published_at INTEGER,                          -- 처음 발행할 때 기록
  slug         TEXT NOT NULL UNIQUE,             -- 고유 주소 = 사이트의 음식 번호(dzk 등). 임시저장에도 필수, 처음 발행한 뒤에는 못 바꿈(영수증이 이 값을 씀)
  sources      TEXT NOT NULL DEFAULT '[]',       -- JSON [[출처 이름, 주소], ...]
  ord          INTEGER,                          -- 같은 연도 안 순서
  data         TEXT NOT NULL DEFAULT '{}',       -- 음식 전용 칸 JSON (icon, hints, opts ...)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1        -- 저장할 때마다 +1 (동시 수정 막기)
);

-- 사이트: 발행된 음식만 꺼낼 때
CREATE INDEX IF NOT EXISTS idx_contents_public
  ON contents (type, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

-- 관리자 목록: 휴지통 아닌 것 (고친 날짜순 정렬용)
CREATE INDEX IF NOT EXISTS idx_contents_admin
  ON contents (updated_at DESC)
  WHERE deleted_at IS NULL;

-- 휴지통 목록·30일 지난 항목 비우기
CREATE INDEX IF NOT EXISTS idx_contents_trash
  ON contents (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 업로드한 이미지 한 장. 파일 자체는 저장소(env.STORAGE)의 images/<id>에 있다.
CREATE TABLE IF NOT EXISTS images (
  id          TEXT PRIMARY KEY,                  -- 무작위 24자 (0-9a-f)
  content_id  TEXT,                              -- 어느 음식 파일에서 올렸는지 (영구 삭제 때 같이 정리)
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes       INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_content ON images (content_id);

-- 영수증 (Render에서 옮겨 옴). 같은 브라우저 번호면 덮어씀. 이름·서명은 저장 안 함.
CREATE TABLE IF NOT EXISTS receipts (
  client_id   TEXT PRIMARY KEY,
  data        TEXT NOT NULL,                     -- JSON {items, total, sens, rank, ate}
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- 1년 지난 영수증 지우기(하루 한 번 예약 작업)
CREATE INDEX IF NOT EXISTS idx_receipts_updated ON receipts (updated_at);

-- 관리자 로그인 상태. 쿠키에는 무작위 값을 주고, DB에는 그 값의 해시만 둔다.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  pw_tag      TEXT NOT NULL,                     -- 로그인 당시 비밀번호의 지문. 비밀번호가 바뀌면 안 맞아서 로그인이 풀림
  expires_at  INTEGER NOT NULL,                  -- 7일 뒤
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);

-- 로그인 실패 기록 (10분 안에 5번 틀리면 10분 막기)
CREATE TABLE IF NOT EXISTS login_failures (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL,                            -- 막는 단위 (2단계에서 정함)
  at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_failures_key_at ON login_failures (key, at);
