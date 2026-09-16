import { Link } from "react-router-dom";
import { ChevronRightIcon } from "../components/ui/icons";

const ROLES = [
  {
    role: "manager" as const,
    title: "Manager",
    text: "Research, draft, and move content through the pipeline, from idea to published.",
  },
  {
    role: "reviewer" as const,
    title: "Reviewer",
    text: "Approve or reject a draft before anything goes out.",
  },
];

// This is a UX starting point only, not an access grant — which role a
// signed-in account actually gets (ManagerLayout vs ReviewerLayout,
// what data RLS lets it touch) is still decided entirely server-side
// from the staff table (see useAuth.ts) after real authentication.
// Picking "Reviewer" here doesn't make an account a reviewer.
export default function SignInChoice() {
  return (
    <div className="auth-page">
      <div className="auth-top">
        <div className="auth-hero-blob auth-hero-blob-1" aria-hidden="true" />
        <div className="auth-hero-blob auth-hero-blob-2" aria-hidden="true" />

        <div className="auth-nav-wrap">
          <nav className="auth-nav-pill">
            <Link to="/" className="auth-nav-brand">
              <span className="auth-nav-logo">
                <img src="/logo.png" alt="" />
              </span>
              Content Agent
            </Link>
          </nav>
        </div>

        <section className="auth-hero" style={{ paddingBottom: "var(--s16)" }}>
          <div className="auth-hero-content is-wide" style={{ gap: "var(--s8)" }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-3xl)", margin: "0 0 var(--s3)" }}>
                Sign in as
              </h1>
              <p className="auth-hero-sub" style={{ fontSize: "var(--text-lg)" }}>
                Choose how you'll be using Content Agent.
              </p>
            </div>

            <div className="role-choice-grid">
              {ROLES.map((r) => (
                <Link key={r.role} to={`/sign-in/${r.role}`} className="card card-link role-choice-card">
                  <div className="role-choice-title">
                    {r.title}
                    <ChevronRightIcon size={22} />
                  </div>
                  <p className="role-choice-text">{r.text}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
