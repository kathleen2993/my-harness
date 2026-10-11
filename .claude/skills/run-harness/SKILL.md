---
name: run-harness
description: 의뢰서 CG 제작 하네스 실행. "이 의뢰서로 전면 만들어줘", "전면 CG 만들어줘", "의뢰서 돌려줘", "전면 이어서 해줘", "전면 검수해줘", "검수 돌려줘", "전면 상태 알려줘" 같은 요청에 사용.
---

# 의뢰서 CG 제작 하네스 실행 절차 (오케스트레이터용)

기준: `CLAUDE.md` · 판정 숫자: `harness/rules.yaml` · 해석 규칙: `harness/guides/parsing.md`

## 0. 어떤 요청인가
| 요청 | 시작점 |
|---|---|
| "이 의뢰서로 전면 만들어줘" + 파일 | 1부터 (새 실행) |
| "전면 이어서 해줘" | `runs/`에서 대상 실행을 고르고 `state.json`의 `stage`부터 |
| "전면 검수해줘" | 5부터 |
| "전면 상태 알려줘" | `node harness/scripts/verify.mjs status runs/<slug>` 결과를 쉬운 말로 요약하고 남은 일 안내 |

## 1. 새 실행 (첫 실행 질문)
디자이너에게 묻는다: ① 의뢰자 이름 ② 방송 날짜·시간(YYMMDD_HHMM) ③ Figma 파일 링크와 템플릿 페이지(기본: `플러그인 컴포넌트 v2`) ④ "판단 필요" 슬라이드 처리 방침
```bash
node harness/scripts/new-run.mjs <의뢰서.docx> <의뢰자> <YYMMDD_HHMM>
```
`state.json`에 `fileKey`, `pageId`, `templates`(아래 기본값, 파일이 바뀌면 확인)를 기록한다.
```json
{ "mobileLiveModule": "7:706", "cardPrd": "7:564", "cardChecklist": "7:541", "cardStory": "7:552", "cardMultiPrd": "11:6217", "cardGift": "12:6673", "bg": "7:442", "logo": "7:445", "banner": "11:975" }
```

## 2. p1·p2 — 분석가에게 맡긴다
`request-analyst` 에이전트를 호출한다 (runs/<slug> 경로 전달). 돌아온 요약에서 "판단 필요"와 임의 값을 디자이너에게 보여준다.

## 3. 게이트1
```bash
node harness/scripts/verify.mjs gate1 runs/<slug>
```
| 결과 | 행동 |
|---|---|
| PASS | 4로 |
| FAIL | 실패 항목을 분석가에게 전달해 p2 재작업 → 다시 게이트1 |
| judgment_needed 실패 | 디자이너에게 해당 슬라이드를 묻는다 (타입 지정 / 직접 제작). 답을 분석가에게 전달 → 직접 제작이면 `manual: true` |
| BLOCKED (3회) | 멈추고 디자이너 호출 |

## 4. p3 — 사람 차례 (대기)
디자이너에게 안내하고 멈춘다:
1. Figma 데스크톱에서 템플릿 페이지를 연다
2. 플러그인 **의뢰서 CG 제작 (하네스용)** 실행 → `runs/<slug>/plan/plan.json`을 끌어다 놓거나 붙여넣고 **📥 하네스 데이터 불러오기** → 배경 이미지가 필요하면 선택·구도 조정 → **생성하기**
3. 폰트 경고(font-report)가 뜨면 그대로 알려달라고 한다 (대체하지 않음)
4. 빈 이미지 칸에 실제 이미지를 넣는다
5. 끝나면 "전면 검수해줘"라고 말한다

## 5. p4 — 판정자에게 맡긴다
`qa-judge` 에이전트를 호출한다 (fileKey, 결과가 있는 pageId, templates.mobileLiveModule 전달 — 디자이너가 다른 페이지에서 실행했으면 그 페이지). 돌려받은 JSON을 **그대로** `runs/<slug>/check/figma-export.json`에 저장한다. 의견은 `check/qa-report.md`에 적는다.
```bash
node harness/scripts/verify.mjs gate2 runs/<slug>
```
| 결과 | 행동 |
|---|---|
| PASS | 6으로 |
| price_mismatch / dummy_text / font_substituted 실패 | p3: 디자이너에게 플러그인 재실행 요청 (원인이 기획이면 p2) |
| card_detached / slide_count_match 실패 | p2 또는 p3 — 원인을 qa-report.md에 적고 디자이너와 결정 |
| BLOCKED | 멈추고 디자이너 호출 |
`check/qa-report.md`에 가격 대조표(원문 ↔ Figma)와 게이트 결과를 정리한다.

## 6. 승인 (대기)
```bash
node harness/scripts/verify.mjs approval-init runs/<slug>
```
디자이너에게 `approval.md`를 직접 작성해 달라고 하고 멈춘다. 디자이너가 "승인했어"라고 하면:
```bash
node harness/scripts/verify.mjs approval-check runs/<slug>
```
| 결과 | 행동 |
|---|---|
| APPROVED | 완료. 결과 요약 |
| REJECTED | 반려 사유에 따라 p2(분석가) 또는 p3(플러그인 재실행) |
| BLOCKED | 지문 불일치 — 승인 이후 의뢰서·기획이 바뀜. 게이트2부터 다시 |
| WAIT | 아직 미작성 — 기다린다 |
