import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  getAccessToken,
  setUnauthorizedHandler,
  validateAccessToken,
} from "../api/client";
import { LoginPage } from "../pages/LoginPage";
import { TopicPage } from "../pages/TopicPage";
import { AppLayout } from "./AppLayout";

const AuthEventsBridge = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (location.pathname !== "/login") {
        navigate("/login", { replace: true });
      }
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [location.pathname, navigate]);

  return null;
};

const AuthGuard = () => {
  const location = useLocation();
  const [status, setStatus] = useState<"checking" | "valid" | "invalid">("checking");

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      if (!getAccessToken()) {
        if (!cancelled) {
          setStatus("invalid");
        }
        return;
      }

      setStatus("checking");

      const valid = await validateAccessToken();
      if (!cancelled) {
        setStatus(valid ? "valid" : "invalid");
      }
    };

    void verify();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (status === "checking") {
    return <div className="auth-check">Checking session...</div>;
  }

  if (status === "invalid") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

const HomeRedirect = () => {
  return <Navigate to={getAccessToken() ? "/topics" : "/login"} replace />;
};

export const AppRoutes = () => {
  return (
    <BrowserRouter>
      <AuthEventsBridge />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<AuthGuard />}>
          <Route path="/topics" element={<AppLayout />}>
            <Route index element={<TopicPage />} />
            <Route path=":topicId" element={<TopicPage />} />
          </Route>
        </Route>

        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
};
