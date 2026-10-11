# 의뢰서 CG 제작 하네스

Word 의뢰서 1건을 넣으면 Claude가 슬라이드를 분석·기획하고, Figma 플러그인이 템플릿 컴포넌트로 CG를 만들고, 판정 스크립트가 **가격 100% 일치 · detach 0개**를 검사한 뒤 디자이너가 승인하면 끝나는 Claude Code 하네스입니다.

> 허들링 클럽 1차 실험 제출물 — 트랙 A(하네스 인증) + 트랙 B(도메인 스토리텔링)

![시연 결과](runs/261020_1100_홍길동/check/result.png)

## 흐름

```
p1 의뢰서 분석 ─ p2 기획 ─ 🚦게이트1 ─ p3 플러그인 실행·이미지 (사람) ─ p4 검수 ─ 🚦게이트2 ─ 👤 승인
   (분석가)        (분석가)   (verify.mjs)                              (판정자)    (verify.mjs)  (approval.md)
```

| 말 | 동작 |
|---|---|
| "이 의뢰서로 전면 만들어줘" + 파일 | 새 실행 |
| "전면 이어서 해줘" / "전면 검수해줘" / "전면 상태 알려줘" | 이어서 / 검수 / 상태 |

## 구조 (4겹)

| 겹 | 파일 |
|---|---|
| 기준 | `docs/` — [story-service](docs/story-service.md)(합격선), [story-work](docs/story-work.md)(게이트 위치), [PRD](docs/PRD.md), [design](docs/design.md), [interview](docs/interview.md)(R2~R8 설계 기록) |
| 규칙 | [`harness/rules.yaml`](harness/rules.yaml)(판정 숫자 SSOT), [`harness/guides/parsing.md`](harness/guides/parsing.md)(의뢰서 해석 규칙), `harness/templates/approval.md` |
| 실행 | [`CLAUDE.md`](CLAUDE.md), `.claude/agents/`(분석가 · 읽기 전용 판정자), `.claude/skills/run-harness/`, `harness/scripts/`(verify · new-run · docx-text · figma-export) |
| 강제 | `.claude/settings.json` + `guard-write.mjs`(approval.md·게이트 결과·원본·규칙 보호) + `guard-figma-readonly.mjs`(Claude는 Figma 읽기만) |
| 도구 | [`figma-plugin/`](figma-plugin/CHANGES.md) — 하네스 데이터(plan.json)를 받아 Figma에 생성 |

## 게이트

- **게이트1 (기획)**: 타입 누락 0 · 필수 칸 누락 0 · 판단 필요 0 · 체크 항목 ≤5 · 장수 일치 · ★가격이 원문과 양방향 일치 · 이미지 지시문 글자 입력 0
- **게이트2 (Figma)**: ★가격 불일치 0 · ★카드 detach 0 · 더미 글자 0 · 기획 글자 누락 0 · 폰트 대체 0 · 장수·순서 · 슬림배너·빈 전면
- 같은 게이트 3회 실패 → 멈추고 디자이너 호출 / 승인 후 의뢰서·기획이 바뀌면 지문 불일치로 승인 무효

★ = `docs/story-service.md`의 "어기면 안 되는 것"

## 시연 (가상 의뢰서)

- 입력: [`samples/sample_request.docx`](samples/) — 가상 브랜드 "예시뷰티" (실제 의뢰서는 올리지 않음)
- 실행 기록: [`runs/261020_1100_홍길동/`](runs/261020_1100_홍길동/) — `plan/plan.json`, `check/gate1.json`, `check/gate2.json`, `check/qa-report.md`
- 검수 중 실제로 잡아낸 문제와 고친 과정은 `check/qa-report.md`, `docs/interview.md` R8에 기록

## 직접 돌려보려면

**Figma 없이 가능**
```bash
node harness/tests/run-tests.mjs
```
게이트·훅 회귀 테스트 45개 (Node 18+, 외부 패키지 없음)

**전체 흐름 (p3·p4)에는 아래가 필요합니다**
1. Figma 템플릿 컴포넌트 — 레이어 이름 규칙은 `docs/design.md`, 컴포넌트 ID는 `plan.json`의 `templates`에 지정 (템플릿 파일은 회사 디자인 자산이라 포함하지 않음)
2. 플러그인 설치 — Figma 데스크톱 → 플러그인 → 개발 → 매니페스트에서 가져오기 → `figma-plugin/manifest.json`
3. Claude Code를 이 폴더에서 열기 (`CLAUDE.md`·스킬·훅 적용)
