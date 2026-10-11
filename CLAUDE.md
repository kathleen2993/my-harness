# 의뢰서 CG 제작 하네스

Word 의뢰서 1건을 넣으면, 가격·할인율이 원문과 100% 일치하고 detach 0개인 `전면CG_묶음`(전면 + 슬림배너 + 빈 전면)이 Figma에 생성되고, 디자이너가 `approval.md`로 승인하면 끝난다.

## 부르는 말
| 말 | 동작 |
|---|---|
| "이 의뢰서로 전면 만들어줘" + 파일 | 새 실행 (p1부터) |
| "전면 이어서 해줘" | `state.json` 기준으로 멈춘 단계부터 |
| "전면 검수해줘" | p4 검수 + 게이트2 |
| "전면 상태 알려줘" | 현재 단계·게이트 결과·남은 일 |

절차 상세는 `.claude/skills/run-harness/SKILL.md`를 따른다.

## 단계
```
p1 의뢰서 분석 ─ p2 기획 ─ 🚦게이트1 ─ p3 플러그인 실행·이미지 (사람) ─ p4 검수 ─ 🚦게이트2 ─ 👤 approval.md 승인
   (분석가)        (분석가)   (verify.mjs)                              (판정자)    (verify.mjs)    (사람)
```

## 파일 역할
| 경로 | 쓰는 쪽 |
|---|---|
| `runs/<slug>/input/` | 사람 (new-run.mjs가 복사) |
| `runs/<slug>/plan/` | 분석가 `request-analyst` |
| `runs/<slug>/check/` | 오케스트레이터(figma-export.json, qa-report.md) + verify.mjs(gate*.json) |
| `runs/<slug>/state.json` | 오케스트레이터 + verify.mjs |
| `runs/<slug>/approval.md` | **사람만** |
| `harness/rules.yaml` | 판정 기준 — 사람만 수정 |
| `harness/guides/`, `harness/templates/` | 해석 규칙, 승인 양식 |
| `harness/scripts/` | verify(판정), new-run, docx-text, figma-export(읽기), guard(차단) |
| `docs/` | 기준 문서: PRD, design, story-service, story-work, interview |
| `figma-plugin/` | 플러그인 (사람이 Figma 데스크톱에서 실행) |

`<slug>` = `날짜_시간_의뢰자` (예: `261020_1100_홍길동`)

## 판정 결과별 행동
| 결과 | 행동 |
|---|---|
| 통과 (PASS / APPROVED) | 다음 단계로 |
| 실패 (FAIL / REJECTED) | 복귀 경로로: 게이트1 → p2, 게이트2 가격·더미·폰트 → p3, 구조·타입 → p2. 반려는 사유대로 |
| 대기 (WAIT) | 사람 차례(플러그인 실행, 이미지, 승인) — 안내하고 멈춘다 |
| 오류 (ERROR, exit 3) | 스크립트·도구 오류 — 고치려 하지 말고 그대로 보고하고 멈춘다 |
| 차단 (BLOCKED) | 같은 게이트 3회 실패, 승인 지문 불일치 — 디자이너를 부른다 |

## 첫 실행 때 꼭 물어볼 것
1. 의뢰자 이름, 방송 날짜·시간 (폴더명)
2. Figma 파일 링크와 템플릿 페이지 (기본: `플러그인 컴포넌트 v2`)
3. "판단 필요" 슬라이드를 어떻게 할지

## 절대 하면 안 되는 것
- 가격·할인율을 계산하거나 원문과 다르게 쓰기
- 카드 컴포넌트 detach, 템플릿에 없는 레이어 새로 만들기
- `(이미지)` 같은 지시문을 글자로 넣기
- 폰트를 다른 폰트로 바꾸기
- `approval.md` 작성·수정, 게이트 결과 직접 작성, `rules.yaml` 임의 수정 (훅이 차단)
- Figma를 직접 수정하기 — 생성·수정은 플러그인으로 (훅이 차단)
- 실제 의뢰서·PD/MD 실명을 공개 저장소에 올리기 (시연은 `samples/`의 가상 의뢰서)

## 기준 문서
- 합격선: `docs/story-service.md` (★ 가격 100% 일치, 카드 detach 0)
- 게이트 위치·역할 경계: `docs/story-work.md`
- 요구사항: `docs/PRD.md` · 디자인 규칙: `docs/design.md` · 설계 기록: `docs/interview.md`
