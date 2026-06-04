import { ApprovalCenterPanel } from "@/app/approval-center-panel";

const navItems = [
  "Dashboard",
  "Meta Connection",
  "Creative Analysis",
  "Bottleneck Diagnosis",
  "Placement Validator",
  "Renderer",
  "Variant & Experiment",
  "Draft Creator",
  "Approval Center",
  "Settings"
];

const cards = [
  { title: "오늘의 주요 병목", value: "Hook", note: "CTR과 첫 3초 주목도 점검" },
  { title: "placement 오류 위험", value: "#1487569", note: "9:16 variant 승인 대기" },
  { title: "생성 비용 현황", value: "0원", note: "일 한도 5,000원 기준" },
  { title: "승인 대기 Draft", value: "0", note: "PAUSED 생성만 허용" },
  { title: "토큰 상태", value: "Mock", note: "OAuth 연결 전 테스트 모드" },
  { title: "예산 변경", value: "차단", note: "추천만 가능, 실행 API 없음" }
];

const checks = [
  ["Tenant isolation", "적용"],
  ["Token client exposure", "차단"],
  ["Budget mutation endpoint", "없음"],
  ["Risk action approval", "필수"],
  ["Final image guide text", "차단"],
  ["Cross-tenant raw learning", "금지"]
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>newmeta Hermes</strong>
          <span>AI 퍼포먼스 마케터 플랫폼</span>
        </div>
        <nav className="nav" aria-label="Main">
          {navItems.map((item) => (
            <a href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <section className="main">
        <header className="header">
          <div>
            <h1>운영 시간 절감과 승인 기반 실행</h1>
            <p className="muted">
              Meta 광고 분석, 소재 해부, 병목 진단, placement 검수, PAUSED draft 생성을 하나의 흐름으로 묶습니다.
            </p>
          </div>
          <span className="status-pill">예산 자동 변경 하드 블록</span>
        </header>

        <section className="grid" aria-label="Dashboard metrics">
          {cards.map((card) => (
            <article className="card" key={card.title}>
              <h2>{card.title}</h2>
              <div className="metric">
                <strong>{card.value}</strong>
              </div>
              <p className="muted">{card.note}</p>
            </article>
          ))}
        </section>

        <section className="panel">
          <h2>보안 및 승인 체크</h2>
          <div className="checks">
            {checks.map(([label, status]) => (
              <div className="check-row" key={label}>
                <span>{label}</span>
                <span className={status === "차단" || status === "금지" ? "tag bad" : "tag good"}>{status}</span>
              </div>
            ))}
          </div>
        </section>

        <ApprovalCenterPanel />
      </section>
    </main>
  );
}
