# Security and Approval Guardrails

## 1. 핵심 원칙

이 플랫폼은 외부 고객 광고계정 연결 가능성을 포함하므로 내부 도구라도 SaaS 수준의 보안이 필요하다.

## 2. 토큰

- access token은 서버에서만 처리한다.
- token은 encrypted_access_token 컬럼에 암호화 저장한다.
- 브라우저에는 절대 token을 반환하지 않는다.
- 로그에 token, app secret, refresh token, authorization code를 출력하지 않는다.
- token test 결과는 권한/만료/계정 목록만 표시한다.

## 3. Tenant isolation

- 모든 테이블에 tenant_id를 둔다.
- 모든 API 요청은 tenant_id + user role 검증 후 처리한다.
- 고객별 ad_account_id, creative, report, token은 분리한다.
- cross-tenant raw data query는 금지한다.

## 4. Cross-tenant learning

허용:
- 익명화된 aggregate pattern
- 업종/상품군/placement/creative type별 통계
- opt-in된 데이터

금지:
- 고객별 원본 성과 데이터 혼합
- 고객 creative 원본 이미지 공유
- 특정 고객/브랜드 식별 가능한 패턴 노출

## 5. 승인 플로우

자동 허용:
- 조회
- 분석
- 리포트 생성
- 소재 렌더링
- placement 검수
- 비용 추정

1차 승인 필요:
- Meta 이미지/영상 업로드
- ad creative 생성
- PAUSED campaign/adset/ad 생성

2차 승인 필요:
- ACTIVE 전환
- 광고 중지
- 광고 삭제
- 타겟 변경
- creative 교체
- 카탈로그/상품 피드 수정

하드 블록:
- 예산 자동 변경

## 6. Audit log

모든 위험 액션은 다음을 기록한다.

- user_id
- tenant_id
- action
- object_type
- object_id
- before_json
- after_json
- approval_request_id
- ip/user_agent, 가능 시
- created_at

## 7. Policy Risk

AI는 다음을 생성하거나 실행하면 안 된다.

- 허위 가격
- 없는 리뷰/할인/무료배송
- 금지 상품 광고
- 의료/금융/성인/위험 상품에 대한 위험 표현
- 사실 확인 안 된 효과/보장 표현
- 특정 개인 속성 직접 지칭

불확실하면 “확인 필요”로 표시한다.
