import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAccessToken,
  getTopics,
  login,
  setAccessToken,
  validateAccessToken,
} from "../api/client";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Login failed";
};

export const LoginPage = () => {
  const navigate = useNavigate();

  const [username, setUsername] = useState("demo");
  const [password, setPassword] = useState("demo");
  const [loading, setLoading] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const verifyToken = async () => {
      const token = getAccessToken();
      if (!token) {
        if (!cancelled) {
          setCheckingToken(false);
        }
        return;
      }

      const valid = await validateAccessToken();
      if (!valid) {
        if (!cancelled) {
          setCheckingToken(false);
        }
        return;
      }

      try {
        const topics = await getTopics();
        if (cancelled) {
          return;
        }

        if (topics.length > 0) {
          navigate(`/topics/${topics[0].topicId}`, { replace: true });
        } else {
          navigate("/topics", { replace: true });
        }
      } catch {
        if (!cancelled) {
          navigate("/topics", { replace: true });
        }
      }
    };

    void verifyToken().finally(() => {
      if (!cancelled) {
        setCheckingToken(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await login(username.trim(), password);
      setAccessToken(response.access_token);

      const topics = await getTopics();
      if (topics.length > 0) {
        navigate(`/topics/${topics[0].topicId}`, { replace: true });
      } else {
        navigate("/topics", { replace: true });
      }
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setLoading(false);
    }
  };

  if (checkingToken) {
    return <div className="auth-check">Checking session...</div>;
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>SciAgentDemo</h1>
        <p>Login with demo account</p>

        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>

        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
};
