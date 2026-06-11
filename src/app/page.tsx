import { ApprovalCenterPanel } from "@/app/approval-center-panel";
import { MetaConnectionPanel } from "@/app/meta-connection-panel";
import { SettingsPanel } from "@/app/settings-panel";

const navItems = [
  { href: "dashboard", label: "대시보드" },
  { href: "meta-connection", label: "메타 연결" },
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
    value: "훅",
    note: "CTR과 첫 3초 주목도를 검토해야 합니다."
  },
  {
    title: "지면 리스크",
    value: "#1487569",
    note: "9:16 소재는 초안 생성 전에 검증이 필요합니다."
  },
  {
    title: "오늘 AI 비용",
    value: "0 KRW",
    note: "일일 한도는 서버에서 강제됩니다."
  },
  {
    title: "대기 중 초안",
    value: "0",
    note: "PAUSED 상태 초안 생성만 허용됩니다."
  },
  {
    title: "메타 토큰 방식",
    value: "OAuth",
    note: "고객이 메타 액세스 토큰을 붙여넣지 않습니다."
  },
  {
    title: "예산 변경",
    value: "차단",
    note: "추천 문구만 허용되며 실행 경로는 없습니다."
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
          <span>메타 광고 크리에이티브 운영</span>
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
            <h1>승인 우선 메타 운영</h1>
            <p className="muted">
              크리에이티브 분석, 병목 진단, 지면 검증, PAUSED 초안 생성은 모두 테넌트 단위 보호 장치를 거칩니다.
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
