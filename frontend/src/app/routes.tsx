import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { setUnauthorizedHandler } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AdminDashboard } from "../pages/AdminDashboard";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { ScholarSearchHome } from "../pages/ScholarSearchHome";
import { TopicPage } from "../pages/TopicPage";
import { AppLayout } from "./AppLayout";

const AuthEventsBridge = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { switchAccount } = useAuth();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      switchAccount();
      if (location.pathname !== "/login") {
        navigate("/login", { replace: true });
      }
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [location.pathname, navigate, switchAccount]);

  return null;
};

const RequireAuth = () => {
  const location = useLocation();
  const { checking, isAuthenticated } = useAuth();

  if (checking) {
    return <div className="auth-check">Checking session...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
};

const RequireAdmin = () => {
  const { checking, isAuthenticated, isAdmin } = useAuth();

  if (checking) {
    return <div className="auth-check">Checking session...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <section className="admin-page">
        <article className="admin-unauthorized-card">
          <h2>403 Forbidden</h2>
          <p>Admin role is required to access this page.</p>
        </article>
      </section>
    );
  }

  return <Outlet />;
};

const GuestOnly = () => {
  const { checking, isAuthenticated } = useAuth();

  if (checking) {
    return <div className="auth-check">Checking session...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/app-center" replace />;
  }

  return <Outlet />;
};

const HomeRedirect = () => {
  const { checking, isAuthenticated } = useAuth();

  if (checking) {
    return <div className="auth-check">Checking session...</div>;
  }

  return <Navigate to={isAuthenticated ? "/app-center" : "/login"} replace />;
};

const LegacyTopicsRedirect = () => {
  const location = useLocation();
  const { topicId } = useParams();
  const path = topicId ? `/app/${topicId}` : "/app";
  return <Navigate to={`${path}${location.search}`} replace />;
};

export const AppRoutes = () => {
  return (
    <BrowserRouter>
      <AuthEventsBridge />
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="/app-center" element={<ScholarSearchHome />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<TopicPage />} />
            <Route path=":topicId" element={<TopicPage />} />
          </Route>
          <Route path="/topics" element={<LegacyTopicsRedirect />} />
          <Route path="/topics/:topicId" element={<LegacyTopicsRedirect />} />
        </Route>

        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
};
