# 의뢰서 해석 가이드 (분석가용)

> 분석가(request-analyst)가 p1·p2에서 따르는 규칙. 판정 숫자는 `harness/rules.yaml`, 디자인 규칙은 `docs/design.md`가 기준이다.
> 🚦 표시 = 게이트에서 스크립트가 실제로 검사하는 규칙

## 1. p1 — 슬라이드 나누기 (`plan/slides.json`)

1. `node harness/scripts/docx-text.mjs runs/<slug>/input/<의뢰서>.docx` 로 읽는다. 직접 추측해서 다시 쓰지 않는다.
2. 표의 **숫자 행(1, 2, 3…) 바로 아래 칸**이 슬라이드다. 빈 칸은 슬라이드가 아니다.
3. 메타데이터(PD, MD, SH, 이전 전면 참고, 백그라운드, ※ 안내)는 슬라이드가 아니다. `meta`에 따로 둔다.
4. "상단 (반투명) 슬림 전면 / 슬림배너" 라벨 뒤의 표는 **슬림배너 항목**이다.
5. "내용 없는 / 자막 없는 / 아무것도 없는 전면" 요청이 있으면 **빈 전면 1장**을 맨 끝에 추가한다.

```json
{ "meta": { "title": "...", "pd": "...", "md": "...", "reference": "...", "background": "..." },
  "slides": [ { "num": 1, "raw": "칸 원문 그대로" } ],
  "banners": [ { "raw": "칸 원문 그대로" } ],
  "emptySlideRequested": true }
```

## 2. p2 — 타입 정하기 (`plan/plan.json`)

| 의뢰서 내용 | type | compType |
|---|---|---|
| 상품 1개 + 가격 | `PRD_PRICE` | `#MainCard_Prd` |
| 혜택·특장점 나열 (V, ✓, 체크) | `BENEFIT_LIST` | `#MainCard_Checklist` |
| 브랜드 스토리, 판매 실적, 효능 설명 | `STORY_DESC` | `#MainCard_Story` |
| 한 화면에 상품 2~3개 세로 배치 ("2단", "2단 박스 분리", 구분선으로 나눈 상품들) | `MULTI_PRD` | `#MainCard_MultiPrd` |
| 사은품·이벤트 (구매 전고객 증정, 구매인증·추첨, 금액대별 사은품) | `GIFT_EVENT` | `#MainCard_Gift` |
| 빈 전면 요청 | `EMPTY` | `NONE` |

- **확신이 없으면 고르지 않는다.** `"judgment": "판단 필요"`, `"judgmentReason": "이유"`를 적고 가장 가까운 타입을 넣는다. 🚦 gate1 `judgment_needed: 0` → 디자이너에게 질문한다.
- 현재 플러그인이 지원하지 않는 형태는 **판단 필요**로 둔다: 다상품 2열·3열·리스트, 리뷰, Q&A, 사이즈표, 비교표.
- 체크 항목은 최대 5개. 🚦 `checklist_max_items: 5`
- **디자이너가 "이건 직접 만들게"라고 답한 슬라이드**: `"manual": true`, `"type": "MANUAL"`, `"compType": "NONE"`, `"manualNote": "디자이너 직접 제작 (사유)"`로 바꾸고 `judgment`는 지운다. 플러그인은 빈 전면 자리만 만들고, 게이트1은 이 슬라이드의 필수 칸·가격 누락 검사를 건너뛴다. 게이트2의 "원문에 없는 가격" 검사는 그대로 적용된다 (디자이너가 넣은 가격도 원문과 같아야 한다).

## 3. 필드 (플러그인 데이터 형식 = 기존 default_data.json)

**상품형 `#MainCard_Prd`**
| 필드 | 의미 | 예 |
|---|---|---|
| `prdTitle` 🚦필수 | 상품명 | `수분 크림 대용량 세트` |
| `prdSubTitle` | 구성·사이즈 | `크림 100ml*2 + 미니 30ml` |
| `tag1`, `tag2` | 상품 태그 (BEST, 신상 등) | `BEST` |
| `originalPrice` | 정상가 (숫자만) | `59,000` |
| `discountRate` | 할인율 | `40%` |
| `discountPrice` 🚦필수 | 할인가 (숫자만). 가격이 하나뿐이면 여기 | `35,400` |
| `priceTag1` | 1행 가격 태그 (방송중 할인, 쿠폰 등. % 포함 문구는 discountRate로) | `방송중 할인` |
| `hasDual`, `priceTag2`, `dualDiscountPrice` | 2행 가격 (행사카드가 등) | `true`, `행사카드 7%`, `32,922` |
| `promotion` | 가격 아래 안내 (무이자, 적립금 등) | `(무3)` |
| `hasImage`, `options`, `imageCount` | 이미지 칸 (4장 참고) | |

**체크리스트형 `#MainCard_Checklist`**: `title`, `showTitle`, `listItems`(🚦1개 이상, 최대 5), `listSubText1~5`(괄호 서브문구), `hasImage`

**스토리형 `#MainCard_Story`**: `title`, `showTitle`, `storyMain1`, `showLogo`, `storyMain2`, `highlightText`, `storySub`, `listItems`, `listSubText`, `hasImage` (본문 🚦1개 이상)

**다상품형 `#MainCard_MultiPrd` (2단)**: `title`, `showTitle`, `items`(🚦2~5개, 각 상품은 상품형 필드: `prdTitle`🚦, `prdSubTitle`, `tag1`, `originalPrice`, `discountRate`, `discountPrice`🚦, `hasImage`…)

**사은품형 `#MainCard_Gift`**: `title`(예: 오늘 하루 혜택이 팡팡!), `showTitle`, `gifts`(🚦1~2개, 각 `{ target: 대상, name: 사은품명🚦, condition: 조건, note: 유의사항, hasImage }`), `tiers`(금액대별 목록, 각 `{ main: "5만원 이상 파우치 1개", sub: "*실결제가 기준" }`, 최대 5개)

**빈 전면**: `{ "num": 7, "type": "EMPTY", "compType": "NONE" }`

**슬림배너 `banners[]`**: `title`, `subtitle`, `tag1`, `tag2`, `priceTag`, `discountRate`, `originalPrice`, `discountedPrice`, `interestFree`

**공통**: `templates`(컴포넌트 ID — 첫 실행 때 확인한 값. 다상품형은 `cardMultiPrd` = Layout=2단 변형 ID, 사은품형은 `cardGift`), `bgColor`(6장)

## 4. 이미지 지시문 🚦

| 의뢰서 표기 | 데이터 |
|---|---|
| `(이미지)`, `(구성 이미지)`, `(누끼)`, `(제품 이미지)` | `hasImage: true` |
| `(블랙 / 화이트 이미지)`, `(각 이미지)` + 색상 나열 | `hasImage: true`, `options: ["블랙", "화이트"]` |
| `(1박스 X5 이미지)` 처럼 개수가 이미지 내용 | `hasImage: true` (칸 1개) |
| 표기 없음 | 상품형은 생략(템플릿 기본 켬), 스토리·체크리스트형은 `hasImage: false` |

- `(이미지)` 같은 지시문을 **글자 칸에 넣지 않는다.** 🚦 `image_instruction_as_text: 0`
- `(로고)`는 로고 표시 지시다 → 스토리형 `showLogo: true`. 글자로 넣지 않는다.
- `(태그)`, `(tag)`, `TAG)`는 태그 표시 지시다 → 앞뒤 문구를 태그 필드로. 지시어 자체는 넣지 않는다.

## 5. 가격 규칙 🚦 (가장 중요)

1. 모든 가격·할인율은 **의뢰서에 적힌 문자열 그대로** 넣는다. 🚦 `price_source_match` / `price_mismatch: 0`
2. **계산 금지.** 할인율·체감가·월 할부금을 직접 계산해서 넣지 않는다. 원문에 없으면 비워 둔다.
3. 숫자 칸에는 숫자만: `35,400원` → `35,400` ("원"은 템플릿 `#WON_txt`가 붙인다). 쉼표는 원문 그대로.
4. 붙은 표기는 보존: `방송중10%` → 그대로.
5. 의뢰서 칸에 있는 가격이 그 슬라이드 데이터에서 빠지면 **gate1에서 누락**으로 걸린다 (판단 필요·직접 제작 슬라이드 제외). 데이터에 있는 가격이 Figma에서 빠지면 gate2에서 걸린다.

## 6. 배경색 (`bgColor`)

의뢰서 "백그라운드" 지시를 HEX로 바꾼다. 이미지 배경("지정 이미지", "뷰티백")이면 `bgColor`는 비우고 디자이너에게 이미지를 요청한다.

| 표현 | bgColor |
|---|---|
| 연한 민트, 민트 그라데이션 | `#DFF5EE` |
| 연한 블루, 블루 | `#E3EEFB` |
| 연두, 연두색 | `#EAF6D9` |
| 노란색 그라데이션 | `#FFF4C9` |
| 핑크, 연핑크, 핑크 그라데이션 | `#FDE7EF` |
| 파스텔 주황 | `#FFE9D9` |
| 흰색, 기본 | `#FFFFFF` |

표에 없는 색은 가장 가까운 연한 색을 고르고 `bgColorNote`에 "임의 선택"이라고 적는다 (원칙 9: 정하지 않은 값은 출처를 붙인다).
