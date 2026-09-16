import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/useAuth";
import SignIn from "./pages/SignIn";
import SignInChoice from "./pages/SignInChoice";
import Landing from "./pages/Landing";
import ManagerLayout from "./components/ManagerLayout";
import ReviewerLayout from "./components/ReviewerLayout";
import RequestList from "./pages/manager/RequestList";
import NewRequest from "./pages/manager/NewRequest";
import RequestDetail from "./pages/manager/RequestDetail";
import Queue from "./pages/manager/Queue";
import ReviewQueue from "./pages/reviewer/ReviewQueue";
import ReviewDetail from "./pages/reviewer/ReviewDetail";
import { supabase } from "./lib/supabaseClient";
import Button from "./components/ui/Button";

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return <div className="center-screen subtitle">Loading…</div>;
  }

  if (!auth.session) {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignInChoice />} />
        <Route path="/sign-in/:role" element={<SignIn />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    );
  }

  if (auth.notStaff) {
    return (
      <div className="center-screen">
        <div className="card stack" style={{ maxWidth: 420 }}>
          <h1>No access</h1>
          <p className="subtitle">
            This account is signed in but is not registered in the staff table, so it has no role (manager or
            reviewer). Ask an admin to add a row for you in Supabase.
          </p>
          <Button variant="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (auth.role === "reviewer") {
    return (
      <ReviewerLayout displayName={auth.displayName} email={auth.session.user.email ?? null}>
        <Routes>
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/review/:id" element={<ReviewDetail />} />
          <Route path="*" element={<Navigate to="/review" replace />} />
        </Routes>
      </ReviewerLayout>
    );
  }

  return (
    <ManagerLayout displayName={auth.displayName} email={auth.session.user.email ?? null}>
      <Routes>
        <Route path="/" element={<RequestList />} />
        <Route path="/new" element={<NewRequest />} />
        <Route path="/request/:id" element={<RequestDetail />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ManagerLayout>
  );
}
