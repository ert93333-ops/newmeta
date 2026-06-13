import { ApprovalCenterPanel } from "@/app/approval-center-panel";
import { AuthSessionPanel } from "@/app/auth-session-panel";
import { CreativeGenerationPanel } from "@/app/creative-generation-panel";
import { DashboardPanel } from "@/app/dashboard-panel";
import { MetaConnectionPanel } from "@/app/meta-connection-panel";
import { SettingsPanel } from "@/app/settings-panel";

const navItems = [
  { href: "dashboard", label: "대시보드" },
  { href: "creative-generation", label: "소재 생성" },
  { href: "approval-center", label: "승인 센터" },
  { href: "settings", label: "설정" },
  { href: "onboarding", label: "온보딩" }
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>newmeta Hermes</strong>
          <span>Meta 광고 자동운영 콘솔</span>
        </div>
        <nav className="nav" aria-label="주요 메뉴">
          {navItems.map((item) => (
            <a href={`#${item.href}`} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <strong>운영 원칙</strong>
          <span>분석과 초안은 자동화하되, 예산 변경은 실행하지 않습니다.</span>
        </div>
      </aside>
      <section className="main">
        <DashboardPanel />
        <CreativeGenerationPanel />
        <ApprovalCenterPanel />
        <SettingsPanel />

        <section className="onboarding-area" id="onboarding">
          <div className="settings-hero">
            <div>
              <h2>온보딩 및 연결</h2>
              <p>처음 설정할 때만 사용하는 로그인과 Meta OAuth 연결입니다. 연결 이후에는 대시보드와 설정을 중심으로 운영합니다.</p>
            </div>
          </div>
          <AuthSessionPanel />
          <MetaConnectionPanel />
        </section>
      </section>
    </main>
  );
}
