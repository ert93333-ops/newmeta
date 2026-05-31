# 조사 후 권장 기본 설정

이 문서는 사용자가 명시하지 않은 항목에 대한 권장 기본값이다.

## 1. 제품 구조

권장 구조:

- Internal-first, SaaS-ready.
- 사용자는 내부 자동화 도구처럼 쓰지만, 외부 고객 광고계정을 연결하므로 멀티테넌트/권한분리/고객별 토큰 구조를 처음부터 넣는다.
- 공개 SaaS 결제/셀프가입은 1순위가 아니어도 DB와 인증 구조는 SaaS 확장 가능하게 만든다.

## 2. Meta 연결

권장:

- 읽기/분석/대량 안정성: Meta Graph/Marketing API 직접 호출.
- AI Agent 연동: Meta MCP Adapter로 추상화.
- 개발/테스트: MockMetaAdapter.

Adapter interface:

- listAdAccounts()
- listCampaigns()
- listAdSets()
- listAds()
- getInsights()
- getCreative()
- uploadImage()
- uploadVideo()
- createCreative()
- createCampaignPaused()
- createAdSetPaused()
- createAdPaused()
- updateStatusWithApproval()
- validatePlacementCompatibility()

## 3. 인증

내부 테스트:

- User access token 가능.

본인/관리 중인 비즈니스 계정 운영:

- System User token 가능.

외부 고객 계정 연결:

- OAuth / Business Login 중심.
- 고객에게 토큰 직접 입력 요구 금지.
- 고객별 encrypted access token 저장.
- 앱 리뷰/권한 검토/Advanced Access 대응.

## 4. 권한 레벨

기본 권한:

- ads_read
- ads_management
- business_management

확장 권한:

- pages_show_list
- pages_read_engagement
- instagram_basic
- instagram_manage_insights
- catalog_management, 필요 시

## 5. 액션 권한 레벨

Level 0: Read Only
- 조회, 분석, 리포트만 가능.

Level 1: Draft Mode
- 이미지/영상 업로드.
- Creative 생성.
- Campaign/Ad Set/Ad를 PAUSED 상태로 생성.

Level 2: Publish Approval
- 사용자가 명시 승인한 경우 ACTIVE 전환 가능.
- 모든 변경 전/후 diff 표시.

Level 3: Destructive Approval
- 광고 중지/삭제/타겟 변경 등 위험 액션은 2단계 승인.

Budget Guard:
- 예산 자동 변경은 하드 블록.
- 예산 변경 추천은 가능하지만 실행은 시스템에서 제공하지 않는다.

## 6. 광고 소재 사이즈 기본값

- Feed hero: 1080x1350, 4:5.
- Square/carousel: 1080x1080, 1:1.
- Stories/Reels: 1080x1920, 9:16.
- Landscape/link/right-column/in-stream 대응용: 1200x628 또는 1920x1080, placement별 필요 시.

## 7. Safe Area 기본값

Feed 4:5:
- left >= 80
- right <= 1000
- top >= 100
- bottom <= 1250

Square 1:1:
- left >= 80
- right <= 1000
- top >= 80
- bottom <= 1000

Stories/Reels 9:16:
- left >= 80
- right <= 1000
- top >= 250
- bottom <= 1580

최종 광고 이미지에는 safe area 문구/가이드라인/픽셀 표시를 넣지 않는다. QA 이미지에만 overlay를 넣는다.

## 8. Creative Analysis 기본 점수

Image:

- Hook Score
- Product Visibility Score
- Layout Score
- Text Readability Score
- Offer Clarity Score
- CTA Strength Score
- Design Consistency Score
- Emotional Trigger Score
- Placement Fit Score
- Safe Area Score
- Policy Risk Score

Video:

- First 3s Hook Score
- Product Timing Score
- Scene Rhythm Score
- Subtitle Score
- Audio Hook Score
- Message Clarity Score
- CTA Timing Score
- Retention Risk Score
- Placement Fit Score
- Policy Risk Score

## 9. 병목 판단 기본 퍼널

- Tracking/Data Quality
- Delivery
- Hook/Attention
- Product Clarity
- Click Intent
- Landing Arrival
- Product Page/Offer
- Checkout
- Revenue/ROAS
- Fatigue
- Placement Fit

## 10. 일예산 5만원 기준 데이터 충분성

일예산 5만원에서는 너무 높은 표본 기준을 잡으면 판단이 늦어진다. 기본값은 아래처럼 둔다.

Observation 상태:
- impressions < 500
- link_clicks < 20
- landing_page_views < 15
- purchases < 1

Weak Signal 상태:
- impressions >= 500
- link_clicks >= 20
- landing_page_views >= 15

Actionable Signal 상태:
- impressions >= 1,500
- link_clicks >= 50
- landing_page_views >= 30
- add_to_cart >= 5
- purchases >= 2

High Confidence 상태:
- impressions >= 3,000
- link_clicks >= 100
- landing_page_views >= 80
- add_to_cart >= 10
- purchases >= 3~5

주의:
- 구매/ROAS 판단은 표본이 작으면 확정하지 않는다.
- CTR/LPV/초기 hook 판단은 구매보다 낮은 표본에서도 가능하지만 confidence를 낮게 둔다.

## 11. Benchmark 권장 방식

우선순위:

1. 같은 계정, 같은 objective, 같은 optimization_goal, 같은 placement, 최근 30일 중앙값.
2. 같은 계정, 최근 90일 중앙값.
3. 같은 tenant의 유사 상품/카테고리.
4. 익명화된 cross-tenant pattern bank.
5. 사용자가 입력한 target CPA/ROAS/CTR.

평균보다 median, p25, p75, MAD 기반 robust z-score를 우선 사용한다.

## 12. Cost Guard

Higgsfield/외부 생성형 AI 비용은 하드코딩하지 않는다.

설정창에서 다음을 입력받는다.

- Higgsfield plan
- monthly price
- monthly credits
- cost per image generation
- cost per video generation
- model별 credit cost
- 월 생성 예산
- 일 생성 예산
- 원/달러 환율

기본 제한:

- 일 AI 생성/분석 비용 상한 = min(일광고예산의 10%, 사용자가 설정한 일 한도)
- 일예산 5만원 기준 기본 AI 비용 상한 = 5,000원/일
- hard cap = 7,500원/일
- 영상 생성은 이미지 생성보다 비용이 크므로 사용자 승인 후 실행
- failed generation 재시도는 최대 1회 자동, 그 이상은 수동 승인
- 같은 소재 분석 결과는 캐시하여 중복 비용 방지

## 13. Cross-Tenant Learning

사용자 요청은 “합쳐서 알고리즘 개선”이지만 보안상 원본 데이터 혼합은 금지한다.

허용:
- 익명화된 feature-performance 패턴
- 업종/상품군/placement/소재타입별 aggregate stats
- PII 제거
- ad_account_id 제거
- brand/customer identifier 제거
- opt-in flag 확인

금지:
- 고객 원본 광고 데이터 직접 혼합
- 고객별 creative 원본 이미지 공유
- 고객명/브랜드명/광고계정 ID 포함 학습
- 타 고객에게 특정 고객의 성과 패턴 노출
