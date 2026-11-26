-- 검색 별칭 옮기기 (design-alias.md 8장) — 한 번만 적용
-- index.html의 ALIAS 12개를 음식 파일 data.alias로 옮김 (dzk는 띄어쓰기만 다른 2개를 합쳐 1개 → 모두 11개)
-- 이미 data.alias가 있는 음식은 건드리지 않음 (관리자 페이지에서 먼저 고친 내용을 덮어쓰지 않게)
-- 옮긴 음식은 version +1, updated_at = 지금 (편집 화면 동시 수정 보호와 맞춤)

UPDATE contents
SET data = json_set(data, '$.alias', json(
      CASE slug
        WHEN 'dzk' THEN '["두바이 쫀득 쿠키"]'
        WHEN 'hjs' THEN '["한정선","과일 찹쌀떡"]'
        WHEN 'yaj' THEN '["요거트 아이스크림의 정석"]'
        WHEN 'ysc' THEN '["연세우유 크림빵"]'
        WHEN 'gpb' THEN '["곰표 맥주"]'
        WHEN 'cst' THEN '["대왕 카스텔라"]'
        WHEN 'jcy' THEN '["쥬씨"]'
        WHEN 'bhi' THEN '["벌꿀 아이스크림","소프트리"]'
        WHEN 'sbg' THEN '["설빙"]'
      END)),
    version = version + 1,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE slug IN ('dzk', 'hjs', 'yaj', 'ysc', 'gpb', 'cst', 'jcy', 'bhi', 'sbg')
  AND json_valid(data)
  AND json_type(data, '$.alias') IS NULL;
