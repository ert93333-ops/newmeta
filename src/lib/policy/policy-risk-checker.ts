export interface PolicyRiskResult {
  status: "pass" | "needs_review" | "blocked";
  findings: string[];
}

const BLOCKED_PATTERNS = [
  /100%\s*완치/,
  /무조건\s*수익/,
  /보장\s*수익/,
  /성인용품/,
  /불법/,
  /마약/
];

const REVIEW_PATTERNS = [
  /무료배송/,
  /한정수량/,
  /리뷰\s*\d+/,
  /할인/,
  /의학/,
  /금융/,
  /대출/,
  /비포\s*애프터/,
  /당신의\s*(나이|몸무게|질병|소득)/
];

export function checkPolicyRisk(text: string): PolicyRiskResult {
  const findings: string[] = [];
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(`차단 위험 표현: ${pattern.source}`);
    }
  }
  if (findings.length > 0) {
    return { status: "blocked", findings };
  }

  for (const pattern of REVIEW_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(`확인 필요 표현: ${pattern.source}`);
    }
  }

  if (findings.length > 0) {
    findings.push("불확실한 할인/리뷰/배송/효과 정보는 실행 전에 근거 확인이 필요합니다.");
    return { status: "needs_review", findings };
  }

  return {
    status: "pass",
    findings: ["정책 위험 키워드가 발견되지 않았습니다."]
  };
}
