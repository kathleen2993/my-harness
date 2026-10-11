# 플러그인 변경 기록 (하네스용, 2026-10-11)

원본: `../../MobileLive_FullCG_Frame/` (베타). 원본은 수정하지 않았다.

| # | 피드백 | 변경 |
|---|---|---|
| 1 | Gemini 분석은 구버전이고 하네스(Claude)와 중복 | Gemini 분석 코드·버튼 삭제. **"📥 하네스 데이터 불러오기"** 추가 (p2_plan.json 붙여넣기 또는 .json 파일 드롭) |
| 2 | API 키 처리 방식 (평문 저장, URL에 키 노출) | Gemini 삭제로 API 키 자체가 없어짐. 키 입력칸·저장 코드·storage 메시지 처리 삭제 |
| 3 | 매니페스트 최소 구성 | `documentAccess: dynamic-page`, `networkAccess: none`(외부 통신 차단) 추가. 원본과 겹치지 않게 id 변경. 표시 이름 "의뢰서 CG 제작 (하네스용)" |
| 4 | 템플릿을 레이어 이름으로 탐색 | p2_plan.json의 `templates`에 적힌 **컴포넌트 ID로 정확히** 찾고, COMPONENT가 아니면 거부. ID가 없을 때만 "이름이 정확히 같은 COMPONENT 1개"를 찾음. 비슷한 이름의 일반 프레임으로 대체하던 코드 삭제. 필요한 템플릿이 없으면 아무것도 만들지 않고 에러로 멈춤 |
| 5 | 폰트 대체가 조용히 일어남 | Inter/Roboto 대체 삭제. 폰트를 못 불러오면 글자를 넣지 않고 **목록으로 보고**(font-report). 더미 글자가 남아 하네스 게이트2에서 걸림 |

추가: `compType: "NONE"` = 빈 전면 (카드 없이 배경·로고만).

## 하네스 데이터 형식 (p2_plan.json)

```json
{
  "templates": { "mobileLiveModule": "7:706", "cardPrd": "7:564", "cardChecklist": "7:541", "cardStory": "7:552", "bg": "7:442", "logo": "7:445", "banner": "11:975" },
  "bgColor": "#DFF5EE",
  "slides": [ { "num": 1, "type": "BENEFIT_LIST", "compType": "#MainCard_Checklist", "...": "..." } ],
  "banners": [ { "title": "...", "discountRate": "40%", "discountedPrice": "35,400" } ]
}
```
슬라이드 필드는 기존 `default_data.json`과 같다.

## 설치

Figma 데스크톱 → 메뉴 → 플러그인 → 개발 → **매니페스트에서 플러그인 가져오기** → 이 폴더의 `manifest.json`

## 추가 (2026-10-11 오후): 다상품 2단 · 사은품 카드

| compType | 템플릿 (templates 키) | 데이터 |
|---|---|---|
| `#MainCard_MultiPrd` | `cardMultiPrd` = v2 `#MainCard_MultiPrd`의 **Layout=2단** 변형 ID (이름으로 못 찾으므로 ID 필수) | `items[]` (2~5개, 각 상품형 필드). 상품 칸 `#Prd_Item_1~3`마다 기존 `fillPrdCard` 재사용, `Item 3~5` 토글로 개수 조절 |
| `#MainCard_Gift` | `cardGift` = `#MainCard_Gift` | `title`, `gifts[]`(target·name·condition·note), `tiers[]`(main·sub). `Gift 2`, `Tier List (금액대별)` 토글, 텍스트 묶음의 `Main 1/Main 2/Highlight/Sub` 토글 |

- 변형(variant)으로 만든 카드는 세트 이름(`#MainCard_MultiPrd`)으로 이름을 붙여 검수에서 카드로 인식되게 함
- 모의 테스트 6개 통과 (상품 칸 채우기, Item 토글, 사은품 글자·토글, 금액대별 목록)
- 아직 미지원: 다상품 2열·3열·리스트·이미지공유, 리스트형(리뷰 등) → 분석가가 "판단 필요"로 넘김
