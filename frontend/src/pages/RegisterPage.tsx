import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 404) {
    return "Backend endpoint /api/auth/register is not available yet.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Register failed";
};

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const accountType = useMemo(() => {
    return account.includes("@") ? "email" : "username";
  }, [account]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedAccount = account.trim();
    if (!normalizedAccount) {
      setError("Email or username is required.");
      return;
    }
    if (password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await register(
        accountType === "email"
          ? { email: normalizedAccount, username: normalizedAccount, password }
          : { username: normalizedAccount, password },
      );
      navigate("/app-center", { replace: true });
    } catch (registerError) {
      setError(getErrorMessage(registerError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Create Account</h1>
        <p>Register and start using SciAgentDemo.</p>

        <label>
          Email or Username
          <input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            autoComplete="username"
            placeholder="you@example.com or your_name"
          />
        </label>

        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
          />
        </label>

        <label>
          Confirm Password
          <input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create Account"}
        </button>

        <p className="auth-page-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
};
