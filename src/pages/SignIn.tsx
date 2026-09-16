import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Field from "../components/ui/Field";
import Button from "../components/ui/Button";
import ErrorState from "../components/ui/ErrorState";
import StatusPill from "../components/ui/StatusPill";

const ROLE_LABELS = { manager: "Manager", reviewer: "Reviewer" } as const;

// The :role in the URL (from the SignInChoice picker) is display-only —
// it labels this form "Signing in as Manager/Reviewer" for clarity, but
// carries no weight with Supabase auth. Which role an account actually
// gets after signing in is decided entirely server-side from the staff
// table (see useAuth.ts / App.tsx), same as if this param weren't here.
export default function SignIn() {
  const { role } = useParams<{ role: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (role !== "manager" && role !== "reviewer") {
    return <Navigate to="/sign-in" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <div className="auth-page">
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

      <div className="center-screen" style={{ flex: 1, minHeight: 0, padding: "var(--s10) var(--s5)" }}>
        <form className="card stack auth-signin-card" onSubmit={handleSubmit}>
          <div>
            <Link to="/sign-in" className="subtitle">
              ← Choose a different role
            </Link>
            <div className="row" style={{ marginTop: "var(--s2)" }}>
              <h1 style={{ margin: 0 }}>Sign in</h1>
              <StatusPill tone="accent">{ROLE_LABELS[role]}</StatusPill>
            </div>
            <p className="subtitle" style={{ margin: 0 }}>
              Use your staff account.
            </p>
          </div>
          {error && <ErrorState message={error} />}
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              className="ui-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              className="ui-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" loading={loading} style={{ width: "100%" }}>
            Sign in
          </Button>
          <p className="subtitle" style={{ margin: 0 }}>
            No self-service signup: ask an admin to create your account and add you to the staff table.
          </p>
        </form>
      </div>
    </div>
  );
}
