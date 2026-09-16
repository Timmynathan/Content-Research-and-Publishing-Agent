import { Link } from "react-router-dom";
import StatusPill from "../components/ui/StatusPill";
import { ChevronRightIcon } from "../components/ui/icons";

const FEATURES = [
  {
    title: "Nothing made up",
    text: "Every fact in your article links back to a page the system actually read. Click any claim to see where it came from.",
  },
  {
    title: "It checks its own work first",
    text: "Claude AI writes a few versions, scores them against quality rules, and rewrites the weak parts before anything reaches your desk.",
  },
  {
    title: "Nothing goes out without a yes",
    text: "Someone on your team approves it first. Until then, nothing touches LinkedIn, X, or your newsletter.",
  },
];

// The marketing-style entry point for signed-out visitors. The actual
// email/password form lives on its own route (SignIn.tsx) — this page
// is just the hero + a "Sign in" way in, same split as a typical
// product landing page vs. its login screen.
export default function Landing() {
  return (
    <div className="auth-page">
      <div className="auth-top">
        <div className="auth-hero-blob auth-hero-blob-1" aria-hidden="true" />
        <div className="auth-hero-blob auth-hero-blob-2" aria-hidden="true" />

        <div className="auth-nav-wrap">
          <nav className="auth-nav-pill">
            <span className="auth-nav-brand">
              <span className="auth-nav-logo">
                <img src="/logo.png" alt="" />
              </span>
              Content Agent
            </span>
            <Link to="/sign-in" className="auth-hero-cta is-sm auth-nav-cta">
              Sign in
            </Link>
          </nav>
        </div>

        <section className="auth-hero">
          <div className="auth-hero-content">
            <StatusPill tone="accent">Content Publisher</StatusPill>
            <h1 className="auth-hero-headline">
              Publish and <span className="auth-hero-highlight">distribute content</span> to streamline your workflow
            </h1>
            <p className="auth-hero-sub">
              Every draft is grounded in real sources, scored against a rubric, and reviewed by a person — before it
              reaches LinkedIn, X, or your newsletter.
            </p>

            <Link to="/sign-in">
              <button className="auth-hero-cta">
                Publish content now
                <ChevronRightIcon size={16} />
              </button>
            </Link>
          </div>
        </section>
      </div>

      <section className="auth-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="auth-feature">
            <div className="auth-feature-title">{f.title}</div>
            <p className="auth-feature-text">{f.text}</p>
          </div>
        ))}
      </section>

      <footer className="auth-footer">© {new Date().getFullYear()} Content Agent</footer>
    </div>
  );
}
