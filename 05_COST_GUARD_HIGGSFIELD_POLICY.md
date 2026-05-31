# Higgsfield / AI Cost Guard Policy

## 1. 목적

사용자는 일예산 5만원 광고 운영 기준에서 Higgsfield 또는 외부 AI 생성 비용 때문에 손해가 나지 않도록 비용 제어를 원한다.

## 2. 원칙

- Higgsfield 가격/크레딧은 변동될 수 있으므로 하드코딩하지 않는다.
- Settings에서 사용자가 현재 플랜, 월 비용, 월 크레딧, 모델별 credit cost를 입력/수정할 수 있게 한다.
- 가능하면 provider API 또는 사용자가 입력한 값을 기준으로 예상 비용을 계산한다.
- 생성 전 예상 비용을 표시한다.
- 영상 생성은 비용이 크므로 기본 수동 승인이다.

## 3. 기본 한도

일예산 50,000원 기준:

- 기본 AI 비용 상한: 5,000원/일
- hard cap: 7,500원/일
- 월 AI 비용 상한 기본값: 월 광고예산의 5~10% 중 사용자가 선택
- 자동 분석은 캐시 우선
- 중복 소재 재분석 금지
- 실패한 생성 자동 재시도는 1회

## 4. 비용 계산 변수

테이블: cost_usage_logs

- tenant_id
- provider
- model
- operation_type
- estimated_credits
- actual_credits
- estimated_cost_krw
- actual_cost_krw
- related_asset_id
- related_job_id
- status
- created_at

Settings:

- provider_name
- monthly_plan_price
- monthly_credits
- credit_unit_cost
- image_generation_credit_cost
- video_generation_credit_cost
- analysis_credit_cost
- daily_cost_cap
- monthly_cost_cap
- exchange_rate

## 5. 실행 규칙

자동 허용:
- cached analysis
- low-cost text reasoning
- 기존 이미지 OCR/safezone 검사

승인 필요:
- 이미지 생성 batch
- 영상 생성
- 여러 variant 생성
- 외부 provider credit을 사용하는 작업

중단:
- 일 한도 초과
- 월 한도 초과
- provider credit 부족
- 실패 재시도 1회 초과

## 6. UI 문구

- “예상 생성 비용이 설정한 일 한도에 가까워졌습니다.”
- “영상 생성은 비용이 높아 승인 후 실행됩니다.”
- “동일 소재 분석 결과가 있어 캐시된 결과를 사용했습니다.”
- “현재 작업은 AI 비용 한도를 초과할 수 있어 중단되었습니다.”
