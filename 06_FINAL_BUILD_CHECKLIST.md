# Final Build Checklist

## 설계 전 체크

- [ ] 이 프로젝트가 통합 플랫폼으로 설계되었는가?
- [ ] 내부 도구이지만 외부 고객 광고계정 연결을 고려했는가?
- [ ] 멀티테넌트 구조가 처음부터 들어갔는가?
- [ ] 예산 자동 변경이 하드 블록되어 있는가?
- [ ] 모든 위험 액션이 승인 기반인가?

## Meta 연결

- [ ] MetaAdapter Interface가 있는가?
- [ ] Graph API Adapter가 있는가?
- [ ] MCP Adapter가 있는가?
- [ ] Mock Adapter가 있는가?
- [ ] OAuth/Business Login 구조가 설계되었는가?
- [ ] System User와 User Token의 사용 목적이 구분되었는가?

## Creative Analysis

- [ ] 이미지 구성요소 분석이 되는가?
- [ ] 영상 시간축 분석이 되는가?
- [ ] hook type 분류가 되는가?
- [ ] 제품 visibility 점수가 있는가?
- [ ] OCR/가격 정확도 검증이 되는가?
- [ ] policy risk 검사가 되는가?

## Bottleneck Diagnosis

- [ ] Tracking/Data Quality 단계가 있는가?
- [ ] Delivery 단계가 있는가?
- [ ] Hook/Attention 단계가 있는가?
- [ ] Product Clarity 단계가 있는가?
- [ ] Click Intent 단계가 있는가?
- [ ] Landing Arrival 단계가 있는가?
- [ ] Product Page/Offer 단계가 있는가?
- [ ] Checkout 단계가 있는가?
- [ ] Revenue/ROAS 단계가 있는가?
- [ ] Fatigue 단계가 있는가?
- [ ] Placement Fit 단계가 있는가?

## Performance Fusion

- [ ] 소재 feature와 성과 지표를 연결하는가?
- [ ] 인과관계를 단정하지 않는가?
- [ ] confidence가 표시되는가?
- [ ] A/B 테스트 가설을 생성하는가?

## Placement Validator

- [ ] #1487569 위험을 사전 검출하는가?
- [ ] 4:5/1:1/9:16 호환성 검사가 있는가?
- [ ] placement별 variant 제안을 하는가?
- [ ] 광고 생성 전 preflight에 포함되는가?

## Creative Renderer

- [ ] final image와 QA image가 분리되는가?
- [ ] final image에 safezone 문구가 없는가?
- [ ] 한국어 텍스트가 코드 기반으로 렌더링되는가?
- [ ] 가격이 정확히 검증되는가?

## Security

- [ ] token 암호화 저장이 되는가?
- [ ] client token 노출이 없는가?
- [ ] tenant isolation이 적용되는가?
- [ ] role based access control이 있는가?
- [ ] audit log가 있는가?
- [ ] data deletion workflow가 있는가?

## Cost Guard

- [ ] Higgsfield/AI 비용 설정이 있는가?
- [ ] 일/월 비용 한도가 있는가?
- [ ] 영상 생성 승인 플로우가 있는가?
- [ ] 캐시로 중복 분석 비용을 줄이는가?

## UI

- [ ] 모든 경고가 한글로 표시되는가?
- [ ] 기술 용어가 쉬운 설명으로 변환되는가?
- [ ] 승인 전 변경 diff가 보이는가?

## Tests

- [ ] Meta mock test
- [ ] safezone test
- [ ] price accuracy test
- [ ] forbidden text test
- [ ] placement validator test
- [ ] bottleneck scoring test
- [ ] performance fusion test
- [ ] approval guard test
- [ ] token encryption test
- [ ] tenant isolation test
- [ ] cost guard test
