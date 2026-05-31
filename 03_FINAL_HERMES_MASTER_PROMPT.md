# Hermes 최종 개발 프롬프트

너는 Hermes 개발 에이전트다.

아래 요구사항을 기준으로 `newmeta` 프로젝트를 처음부터 설계하고 구현하라. 이 프로젝트는 Meta 광고 운영 시간을 줄이기 위한 내부 자동화 플랫폼이지만, 외부 고객 광고계정 연결도 지원해야 하므로 멀티테넌트 SaaS 수준의 보안/권한/토큰 구조를 갖춰야 한다.

이 프로젝트는 단순 광고 생성기가 아니다.
핵심은 다음 6가지다.

1. Meta 광고계정 연결 및 데이터 수집
2. 이미지/영상 광고 소재 구성요소 해부
3. 광고 성과 병목 진단
4. 소재 요소와 Meta/Pixel/GA4/자사몰 성과 데이터 연결
5. placement mismatch와 #1487569 오류 사전 방지
6. 승인 기반 광고 Draft/실행 자동화

예산 자동 변경은 제외한다.
예산 변경 제안은 가능하지만 시스템은 예산 변경 API 실행 기능을 제공하지 않는다.

============================================================
0. 개발 시작 전 검증 의무
============================================================

코드를 바로 작성하지 마라.
먼저 다음을 제출하라.

1. 전체 아키텍처
2. 모듈 의존성
3. 데이터 흐름
4. DB 스키마
5. API 엔드포인트
6. 권한/승인 플로우
7. 테스트 계획
8. 보안 리스크와 대응
9. 비용 리스크와 대응
10. 구현 순서

이 프로젝트가 단순 리포트/소재 생성기가 아니라 “AI 퍼포먼스 마케터 플랫폼”으로 설계되어 있는지 먼저 검증하라.

============================================================
1. 제품 정의
============================================================

제품명: newmeta / TOMCP / Meta Ads Creative Agent

제품 성격:
- Meta 광고 통합 분석/생성/검수/운영 보조 플랫폼.
- 사용자는 내부적으로 사용하지만 외부 고객 광고계정 연결도 가능해야 한다.
- 광고 운영 시간을 줄이는 것이 최우선 목적이다.

차별점:
- 단순 리포트가 아니라 병목 원인을 설명한다.
- 이미지/영상의 구성요소를 해부한다.
- 소재 요소와 Meta 성과를 연결한다.
- #1487569 같은 placement 오류를 사전 방지한다.
- 안전영역/텍스트/가격 정확도를 자동 검수한다.
- 승인 기반으로만 광고를 실행한다.

============================================================
2. 전체 기능 범위
============================================================

MVP 축소 범위는 없다.
최종 구현 범위에는 가능한 모든 기능이 포함된다.
단, 안전한 개발을 위해 구현 순서는 단계별로 진행한다.

필수 기능:

1. Meta Connection & Auth
2. Meta API/MCP Adapter
3. Creative Analysis Engine
4. Video Creative Analysis Engine
5. Bottleneck Diagnosis Engine
6. Performance Fusion Engine
7. Placement Validator / #1487569 Guard
8. Creative Renderer / Safezone Checker
9. Variant Generator / A/B Test Designer
10. Meta Draft Creator
11. Approval Center
12. Reporting Dashboard
13. Policy Risk Checker
14. Cost Guard
15. Security / Audit / Tenant Isolation
16. Settings / Integrations

제외 기능:
- 예산 자동 변경.

============================================================
3. Meta 연결 구조
============================================================

Meta 연결은 adapter 방식으로 설계한다.

interface MetaAdapter:
- listAdAccounts()
- listCampaigns()
- listAdSets()
- listAds()
- getInsights()
- getCreative()
- getAdImages()
- getAdVideos()
- uploadImage()
- uploadVideo()
- createCreative()
- createCampaignPaused()
- createAdSetPaused()
- createAdPaused()
- updateStatusWithApproval()
- validatePlacementCompatibility()
- getPixelDiagnostics()
- getSignalDiagnostics()

구현체:
- MetaGraphApiAdapter
- MetaMcpAdapter
- MockMetaAdapter

우선순위:
- 안정적 데이터 조회와 저장: Graph/Marketing API 직접 호출.
- AI Agent 연동: MCP Adapter.
- 테스트: Mock Adapter.

============================================================
4. 인증/권한 구조
============================================================

테스트:
- User Access Token 사용 가능.

내부 운영:
- System User Token 사용 가능.

외부 고객 광고계정 연결:
- OAuth / Business Login 기반.
- 고객에게 access token 직접 입력을 요구하지 마라.
- 고객별 encrypted token 저장.
- 앱 리뷰와 필요한 권한 승인을 고려한다.

필수 권한 후보:
- ads_read
- ads_management
- business_management

확장 권한 후보:
- pages_show_list
- pages_read_engagement
- instagram_basic
- instagram_manage_insights
- catalog_management, 필요 시

권한은 Settings에서 연결 상태와 누락 권한을 한글로 표시한다.

============================================================
5. 액션 권한/승인 정책
============================================================

AI는 광고비에 영향을 줄 수 있는 액션을 사용자 승인 없이 실행하면 안 된다.

권한 레벨:

Level 0: Read Only
- 광고계정 조회
- 성과 분석
- 소재 분석
- 병목 진단
- 리포트 생성

Level 1: Draft Mode
- 이미지/영상 업로드
- Creative 생성
- Campaign/Ad Set/Ad를 PAUSED 상태로 생성

Level 2: Publish Approval
- 사용자가 명시적으로 승인한 경우 ACTIVE 전환 가능
- 변경 전/후 diff 표시 필수

Level 3: Destructive Approval
- 광고 중지/삭제/타겟 변경/creative 교체는 2단계 승인
- audit log 필수

Hard Block:
- 예산 자동 변경 API 실행 금지
- 예산 증액/감액은 추천만 가능

============================================================
6. Creative Analysis Engine - 이미지
============================================================

이미지 광고는 단일 점수로 평가하지 말고 구성요소별로 해부한다.

분석 항목:

A. Layout / Composition
- 시선 흐름
- 제품/텍스트/가격/CTA 위치
- 상단/중앙/하단 정보 구조
- 여백
- 정보 과밀도
- 모바일 피드 가독성
- 안전영역 침범 여부

B. Product Visibility
- 제품 bbox 면적 비율
- 제품 중심 위치
- 제품 대비
- 제품 가림 여부
- 사용 장면 존재 여부
- 배경/소품/동물 대비 제품 주목도

C. Hook Analysis
- hook 문구 위치
- hook type 분류
- 1초 내 이해 가능성
- 과장/허위 위험

Hook type:
- 질문형
- 공감형
- 반전형
- 혜택형
- 가격형
- 희소성형
- 사회적 증거형
- 비교형
- 문제제기형
- UGC형

D. Text / Copy Analysis
- OCR 추출
- top hook/main headline/subheadline/USP/CTA/price 구분
- 가독성
- 대비
- 문장 길이
- 줄바꿈
- 오탈자
- 가격 정확도
- 광고 관리자 primary text/headline/description과 비교

E. Offer / Price Analysis
- 가격 노출 여부
- 가격 가독성
- 할인/무료배송/리뷰/한정수량 등 오퍼 요소
- 충동구매 가능성
- 허위 가격 위험

F. CTA Analysis
- CTA 위치
- CTA 문구
- 가격과 CTA 연결성
- 클릭 행동 유도성

G. Design / Aesthetic Analysis
- 색상 팔레트
- 명도 대비
- 브랜드 톤
- 폰트 일관성
- 아이콘 일관성
- 감성/타겟 적합성

H. Emotional Trigger
- 귀여움
- 소장욕구
- 촉각 상상
- 선물 욕구
- 감성 소비
- 반려동물 친화성
- FOMO
- 유머
- 반전

I. Placement Fit
- Feed 적합성
- Stories/Reels 적합성
- 4:5/1:1/9:16별 크롭 리스크
- #1487569 발생 가능성

점수:
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

============================================================
7. Creative Analysis Engine - 영상
============================================================

영상 광고는 반드시 시간축으로 분해한다.

기본 분석:
- 길이
- 해상도
- 비율
- fps
- 파일 크기
- 음성 유무
- BGM 유무
- 효과음 유무
- 자막 유무
- 제품 첫 등장 시간
- 제품 총 노출 시간
- CTA 등장 시점
- 가격 등장 시점
- 컷 수
- 컷 전환 속도

시간 구간:
- 0.0~0.5초
- 0.5~1.0초
- 1~3초
- 3~5초
- 5~10초
- 10초 이후

각 구간 분석:
- 제품 등장 여부
- 사람/동물/손 등장 여부
- 텍스트 등장 여부
- 가격 등장 여부
- CTA 등장 여부
- 화면 변화량
- 사운드 변화량
- 감정 톤
- 이탈 위험

핵심 점수:
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

영상은 무음 시청 가능성도 반드시 평가한다.

============================================================
8. Bottleneck Diagnosis Engine
============================================================

병목 진단은 별도 모듈로 구현한다.
목표는 “성과가 왜 막혔는지”를 퍼널 단계별로 판단하는 것이다.

진단 단계:

1. Tracking/Data Quality
2. Delivery
3. Hook/Attention
4. Product Clarity
5. Click Intent
6. Landing Arrival
7. Product Page/Offer
8. Checkout
9. Revenue/ROAS
10. Fatigue
11. Placement Fit

입력 데이터:

Meta:
- spend
- impressions
- reach
- frequency
- clicks
- link_clicks
- outbound_clicks
- landing_page_views
- ctr
- cpc
- cpm
- actions
- action_values
- cost_per_action_type
- purchase_roas
- video play/retention metrics

Breakdowns:
- age
- gender
- publisher_platform
- platform_position
- impression_device
- country/region
- placement
- ad_format_asset

연동 가능 데이터:
- Meta Pixel
- Meta CAPI
- GA4
- 자사몰 DB

Shopify는 필수 지원하지 않는다.

데이터 충분성 기본값, 일예산 5만원 기준:

Observation:
- impressions < 500
- link_clicks < 20
- landing_page_views < 15
- purchases < 1

Weak Signal:
- impressions >= 500
- link_clicks >= 20
- landing_page_views >= 15

Actionable Signal:
- impressions >= 1,500
- link_clicks >= 50
- landing_page_views >= 30
- add_to_cart >= 5
- purchases >= 2

High Confidence:
- impressions >= 3,000
- link_clicks >= 100
- landing_page_views >= 80
- add_to_cart >= 10
- purchases >= 3~5

데이터 부족 시 확정 진단하지 말고 “관찰 필요” 또는 “신뢰도 낮음”으로 표시한다.

============================================================
9. Performance Fusion Engine
============================================================

Creative Analysis 결과와 Bottleneck Diagnosis 결과를 연결한다.

목표:
- 소재의 어떤 요소가 어떤 성과 병목과 연결되는지 추정한다.
- 상관관계를 인과관계처럼 단정하지 않는다.
- A/B 테스트 전에는 “가설”로 표현한다.

예:
- hook_score 낮음 + CTR 낮음 = Hook 병목 가능성
- product_visibility 낮음 + CTR 낮음 = Product Clarity 병목 가능성
- offer_clarity 낮음 + CVR 낮음 = Offer 병목 가능성
- CTA 약함 + Link CTR 낮음 = Click Intent 병목 가능성
- CTR 높음 + LPV 낮음 = Landing Arrival 병목 가능성
- Frequency 상승 + CTR 하락 = Fatigue 병목 가능성

출력 형식:
- 관찰된 소재 요소
- 관련 성과 지표
- 가능한 원인
- confidence
- 개선 제안
- 다음 A/B 테스트 설계

표현 규칙:
- “원인입니다” 금지
- “가능성이 높습니다”, “추정됩니다”, “검증이 필요합니다” 사용

============================================================
10. Placement Validator / #1487569 Guard
============================================================

오류 #1487569:
“광고의 크리에이티브를 선택한 노출 위치와 함께 사용할 수 없습니다.”

사전 검수:
- 이미지/영상 비율
- 해상도
- 파일 크기
- 영상 길이
- CTA
- creative type
- objective
- selected placement
- asset customization 여부

기본 출력:
- compatible
- incompatible
- risky
- requires_variant

권장 소재:
- Feed: 4:5 / 1080x1350
- Square/Carousel: 1:1 / 1080x1080
- Stories/Reels: 9:16 / 1080x1920
- Landscape/In-stream/Link preview: placement별 별도 변형

불일치 시:
- 광고 생성 요청 중단
- Feed only 제한 제안
- 9:16 variant 생성 제안
- 1:1 variant 생성 제안
- placement asset customization 제안

============================================================
11. Creative Renderer / Safezone
============================================================

최종 광고 이미지는 소비자에게 보여지는 실제 광고다.
최종 이미지에는 가이드선, 안전영역 문구, 픽셀 치수, 레이아웃 설명을 넣지 마라.

Final image:
- 광고 업로드용
- safezone guide 없음
- 사이즈 안내 없음
- 소비자용 완성 이미지

QA image:
- 내부 검수용
- safezone overlay 가능
- 광고 업로드 금지

지원 사이즈:
- 1080x1350 / 4:5
- 1080x1080 / 1:1
- 1080x1920 / 9:16
- 1200x628 / 1.91:1, 필요 시
- 1920x1080 / 16:9, 필요 시

텍스트 렌더링:
- 생성형 이미지 모델에게 한국어 텍스트를 맡기지 마라.
- 최종 텍스트/가격/CTA는 코드 기반 렌더링.
- OCR 또는 layer manifest로 검증.

금지 문구:
- 안전영역
- 안전 영역
- 1080
- px
- 권장 사이즈
- 레이아웃
- 가이드
- safe zone
- safe area

가격 검증:
- 지정 가격이 9,900원이면 정확히 “9,900원”이어야 한다.
- 12,900원, 9900원, 9,900₩, 깨진 한국어는 실패.

============================================================
12. Variant Generator / A/B Test Designer
============================================================

Variant는 무작위 생성하지 말고 분석 결과 기반으로 만든다.

원칙:
- 한 번에 하나의 핵심 변수만 변경한다.
- 나머지는 통제한다.
- 성공 지표와 최소 데이터 기준을 명시한다.

변경 변수 예:
- hook 문구
- 제품 크기
- 제품 위치
- CTA 문구
- 가격 위치
- 색상
- 배경
- 첫 3초 영상 구조
- 자막 밀도
- 오디오 후킹
- placement 전용 비율

출력:
- control
- variant A/B/C
- changed variable
- controlled variables
- primary metric
- secondary metrics
- minimum impressions/clicks
- stop condition

============================================================
13. Meta Draft Creator
============================================================

지원:
- 가능한 모든 광고 형식.
- 가능한 모든 placement.
- 이미지/영상/캐러셀/컬렉션/카탈로그/동적 소재 등은 단계적으로 구현하되 최종 범위에 포함한다.

모든 생성은 기본 PAUSED 상태다.

Preflight Validation:
- token 권한
- ad account 접근
- page_id
- instagram_actor_id, 필요 시
- link_url
- image_hash/video_id
- safe_area_pass
- forbidden_text_pass
- price_accuracy_pass
- placement compatibility
- #1487569 risk
- policy risk
- cost guard
- approval requirement

ACTIVE 전환은 사용자 명시 승인 후만 가능.

============================================================
14. Policy Risk Checker
============================================================

검사 대상:
- 허위 가격
- 금지 상품
- 의료 관련 위험 표현
- 금융 관련 위험 표현
- 성인 상품/성인 표현
- 위험 상품
- 과장 보장 표현
- 없는 정보 꾸며내기
- 리뷰/할인/무료배송 허위 표시
- 특정 개인 속성 지칭 위험

AI는 없는 정보를 만들어내면 안 된다.
불확실한 내용은 “확인 필요”로 표시한다.

============================================================
15. Cost Guard - Higgsfield/AI 비용
============================================================

Higgsfield 또는 외부 생성형 AI 비용은 플랜/크레딧 기반으로 변동될 수 있으므로 하드코딩하지 않는다.

Settings에 다음을 둔다.
- provider
- plan name
- monthly price
- monthly credits
- model별 credit cost
- image generation unit cost
- video generation unit cost
- exchange rate
- daily cost cap
- monthly cost cap

기본값:
- 일 AI 비용 상한 = min(일 광고예산의 10%, 사용자 설정 일 한도)
- 일예산 5만원 기준 기본 상한 = 5,000원/일
- hard cap = 7,500원/일
- 영상 생성은 항상 예상 비용 표시 후 승인
- 중복 분석은 캐시
- failed generation 자동 재시도는 1회만

비용 초과 시 한글 경고:
“현재 생성 비용이 설정한 일 한도를 초과할 수 있어 자동 실행을 중단했습니다.”

============================================================
16. UI 요구사항
============================================================

모든 경고 UI는 한글로 쉽고 명확하게 표시한다.

필수 화면:

1. Dashboard
- 오늘의 주요 병목
- 성과 하락 광고
- 피로도 높은 소재
- placement 오류 위험
- 승인 대기 Draft
- 생성 비용 현황

2. Meta Connection
- 계정 연결
- 권한 상태
- 누락 권한
- 토큰 만료/재연결 안내

3. Creative Analysis
- 이미지/영상 업로드
- 구성요소별 점수
- 근거
- 개선 제안

4. Bottleneck Diagnosis
- 퍼널 단계별 병목
- 증거 지표
- 신뢰도
- 다음 액션

5. Placement Validator
- #1487569 위험 표시
- placement별 호환성
- 필요한 variant 제안

6. Creative Renderer
- final preview
- QA safezone preview
- 가격/OCR/금지문구 검사

7. Variant & Experiment
- 가설 기반 variant
- A/B 테스트 설계

8. Draft Creator
- PAUSED 광고 생성
- preflight 결과

9. Approval Center
- 실행 대기 액션
- 변경 전/후 비교
- 1차/2차 승인

10. Settings
- Meta 연결
- Pixel/CAPI
- GA4
- 자사몰 DB
- Higgsfield/AI 비용
- 권한 레벨
- 데이터 보관/삭제

============================================================
17. 데이터베이스
============================================================

Supabase/PostgreSQL 기준.
모든 주요 테이블에는 tenant_id를 둔다.

필수 테이블:
- users
- tenants
- user_roles
- meta_connections
- ad_accounts
- campaigns_cache
- adsets_cache
- ads_cache
- insights_snapshots
- creative_assets
- creative_jobs
- creative_analysis_jobs
- creative_features
- creative_component_scores
- video_segments
- bottleneck_analysis_jobs
- bottleneck_stage_scores
- bottleneck_hypotheses
- performance_fusion_reports
- creative_hypotheses
- creative_experiments
- creative_learning_patterns
- placement_validation_reports
- ad_drafts
- approval_requests
- audit_logs
- integration_settings
- cost_usage_logs
- benchmark_profiles

데이터 보관:
- 사용자가 삭제할 때까지 보관.
- 삭제 요청 시 token, assets, reports, learning patterns, integration data 삭제 절차 제공.

Cross-tenant learning:
- 원본 데이터 혼합 금지.
- 익명화/집계/옵트인 패턴만 사용.

============================================================
18. 보안
============================================================

필수:
- 토큰 암호화 저장
- 클라이언트 토큰 노출 금지
- 로그에 토큰 출력 금지
- tenant isolation
- role based access control
- audit log
- 위험 액션 승인 플로우
- rate limit 대응
- API key rotation 대응
- data deletion workflow
- 연결 해제 기능

권한 역할:
- Owner
- Admin
- Marketer
- Analyst
- Viewer

============================================================
19. 테스트
============================================================

모든 핵심 기능 테스트를 작성한다.

필수 테스트:
- Meta token test
- /me/adaccounts mock/real adapter test
- insights parsing
- breakdown parsing
- creative OCR checker
- price accuracy checker
- forbidden text checker
- safe area checker
- placement validator
- #1487569 risk detection
- image renderer
- video segmentation mock
- bottleneck scoring
- benchmark calculation
- performance fusion
- variant generation
- preflight validation
- approval guard
- policy risk checker
- cost guard
- tenant isolation
- audit log
- token encryption

MockMetaAdapter를 사용하여 광고비 없이 테스트 가능해야 한다.

============================================================
20. 구현 순서
============================================================

최종 범위는 전체 기능이지만 구현은 아래 순서로 진행한다.

Phase 1. Foundation
- Supabase schema
- Auth/RBAC
- tenant isolation
- audit log
- MetaAdapter interface
- MockMetaAdapter

Phase 2. Meta Connection
- User token test
- OAuth/Business Login 설계
- ad accounts 조회
- insights snapshot

Phase 3. Creative Renderer / Validator
- safezone checker
- final vs QA 분리
- price/OCR/forbidden text
- 4:5/1:1/9:16 export

Phase 4. Creative Analysis
- image component analysis
- video component analysis
- component scores

Phase 5. Bottleneck Diagnosis
- funnel metrics
- data sufficiency
- benchmark profiles
- bottleneck scores

Phase 6. Performance Fusion
- creative feature + performance 연결
- hypothesis generator

Phase 7. Placement Validator
- all placement matrix
- #1487569 guard
- asset customization suggestions

Phase 8. Variant/Experiment
- variant generator
- A/B test plan

Phase 9. Draft Creator / Approval
- PAUSED campaign/adset/ad creation
- approval center
- ACTIVE transition with approval
- no budget edit

Phase 10. Integrations / Cost / Ops
- Pixel/CAPI diagnostics
- GA4 integration
- 자사몰 DB integration
- Higgsfield/AI cost guard
- monitoring

============================================================
21. 최종 산출물
============================================================

Hermes는 다음을 제공하라.

- 동작 가능한 코드베이스
- README.md
- .env.example
- Supabase migration SQL
- API 문서
- DB schema 문서
- Meta 연결 문서
- Creative Analysis 문서
- Bottleneck Diagnosis 문서
- Placement Validator 문서
- Cost Guard 문서
- Security 문서
- 테스트 코드
- Mock 데이터
- 배포 가이드
- 운영 체크리스트

============================================================
22. 절대 하지 말 것
============================================================

- 예산 자동 변경 기능을 구현하지 마라.
- 사용자 승인 없이 ACTIVE 전환하지 마라.
- 사용자 승인 없이 광고 중지/삭제/타겟 변경하지 마라.
- User token을 외부 고객 SaaS 운영 방식으로 사용하지 마라.
- 고객에게 access token을 직접 입력받는 구조를 기본으로 만들지 마라.
- 토큰을 클라이언트에 노출하지 마라.
- 고객 원본 데이터를 섞어 학습하지 마라.
- 상관관계를 인과관계처럼 단정하지 마라.
- 최종 광고 이미지에 safezone/px/가이드 문구를 넣지 마라.
- 한국어 텍스트를 생성형 이미지 모델에 맡기지 마라.
- 없는 할인/리뷰/배송/효과를 만들어내지 마라.
- #1487569 위험을 무시하고 광고 생성 요청을 보내지 마라.
