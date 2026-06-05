import { ApprovalCenterPanel } from "@/app/approval-center-panel";
import { MetaConnectionPanel } from "@/app/meta-connection-panel";
import { SettingsPanel } from "@/app/settings-panel";

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
  {
    title: "Primary Bottleneck",
    value: "Hook",
    note: "CTR and first-3-second attention need review."
  },
  {
    title: "Placement Risk",
    value: "#1487569",
    note: "9:16 variants require validation before draft creation."
  },
  {
    title: "AI Cost Today",
    value: "0 KRW",
    note: "Daily cap is enforced server-side."
  },
  {
    title: "Pending Drafts",
    value: "0",
    note: "Only PAUSED draft creation is allowed."
  },
  {
    title: "Meta Token Mode",
    value: "OAuth",
    note: "Customers never paste Meta access tokens."
  },
  {
    title: "Budget Mutation",
    value: "Blocked",
    note: "Recommendations only; no execution path exists."
  }
];

const checks = [
  { label: "Tenant isolation", status: "RLS scoped", tone: "good" },
  { label: "Token client exposure", status: "Blocked", tone: "good" },
  { label: "Budget mutation endpoint", status: "Absent", tone: "good" },
  { label: "Risk action approval", status: "Required", tone: "good" },
  { label: "Final image guide text", status: "Blocked", tone: "good" },
  { label: "Cross-tenant raw learning", status: "Forbidden", tone: "good" }
] as const;

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>newmeta Hermes</strong>
          <span>Meta Ads creative operations</span>
        </div>
        <nav className="nav" aria-label="Main">
          {navItems.map((item) => (
            <a href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <section className="main" id="dashboard">
        <header className="header">
          <div>
            <h1>Approval-first Meta operations</h1>
            <p className="muted">
              Creative analysis, bottleneck diagnosis, placement validation, and PAUSED draft creation are
              routed through tenant-scoped guardrails.
            </p>
          </div>
          <span className="status-pill">Budget mutation hard-blocked</span>
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

        <MetaConnectionPanel />

        <SettingsPanel />

        <section className="panel" id="security-checks">
          <h2>Security and Approval Checks</h2>
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
