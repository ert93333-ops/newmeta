import { ApprovalCenterPanel } from "@/app/approval-center-panel";
import { AuthSessionPanel } from "@/app/auth-session-panel";
import { MetaConnectionPanel } from "@/app/meta-connection-panel";
import { SettingsPanel } from "@/app/settings-panel";

const navItems = [
  { href: "dashboard", label: "대시보드" },
  { href: "login", label: "운영 로그인" },
  { href: "meta-connection", label: "Meta 연결" },
  { href: "creative-analysis", label: "크리에이티브 분석" },
  { href: "bottleneck-diagnosis", label: "병목 진단" },
  { href: "placement-validator", label: "지면 검증" },
  { href: "renderer", label: "렌더러" },
  { href: "variant-experiment", label: "소재 실험" },
  { href: "draft-creator", label: "초안 생성" },
  { href: "approval-center", label: "승인 센터" },
  { href: "settings", label: "설정" }
];

const cards = [
  {
    title: "주요 병목",
    value: "대기",
    note: "CTR과 첫 3초 주목률을 기준으로 병목을 찾습니다."
  },
  {
    title: "지면 리스크",
    value: "#1487569",
    note: "9:16 소재는 초안 생성 전에 지면 적합성을 검증합니다."
  },
  {
    title: "오늘 AI 비용",
    value: "0 KRW",
    note: "일일 한도는 서버 정책으로 강제됩니다."
  },
  {
    title: "대기 중 초안",
    value: "0",
    note: "Meta 초안은 항상 PAUSED 상태와 승인 흐름으로 생성됩니다."
  },
  {
    title: "Meta 토큰 방식",
    value: "OAuth",
    note: "고객 Meta 액세스 토큰은 서버에만 저장됩니다."
  },
  {
    title: "예산 변경",
    value: "차단",
    note: "예산은 추천 문구만 허용하며 실행 경로는 없습니다."
  }
];

const checks = [
  { label: "테넌트 격리", status: "RLS 적용", tone: "good" },
  { label: "클라이언트 토큰 노출", status: "차단", tone: "good" },
  { label: "예산 변경 엔드포인트", status: "없음", tone: "good" },
  { label: "위험 작업 승인", status: "필수", tone: "good" },
  { label: "최종 이미지 가이드 문구", status: "차단", tone: "good" },
  { label: "테넌트 간 원본 학습", status: "금지", tone: "good" }
] as const;

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>newmeta Hermes</strong>
          <span>Meta 광고 크리에이티브 운영 콘솔</span>
        </div>
        <nav className="nav" aria-label="주 메뉴">
          {navItems.map((item) => (
            <a href={`#${item.href}`} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <section className="main" id="dashboard">
        <header className="header">
          <div>
            <h1>승인 우선 Meta 운영</h1>
            <p className="muted">
              크리에이티브 분석, 병목 진단, 지면 검증, PAUSED 초안 생성을 테넌트 단위로 보호합니다.
            </p>
          </div>
          <span className="status-pill">예산 변경 하드 차단</span>
        </header>

        <section className="grid" aria-label="대시보드 지표">
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

        <AuthSessionPanel />

        <MetaConnectionPanel />

        <SettingsPanel />

        <section className="panel" id="security-checks">
          <h2>보안 및 승인 점검</h2>
          <div className="checks">
            {checks.map((check) => (
              <div className="check-row" key={check.label}>
                <span>{check.label}</span>
                <span className={`tag ${check.tone}`}>{check.status}</span>
              </div>
            ))}
          </div>
        </section>

        <ApprovalCenterPanel />
      </section>
    </main>
  );
}
