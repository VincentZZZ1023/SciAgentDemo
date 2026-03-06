import type {
  AdminMetricsPayload,
  AgentId,
  Message,
  RunConfig,
  RunCreateResponse,
  RunDetail,
  SnapshotResponse,
  TraceResponse,
  TopicDetail,
  TopicSummary,
} from "../types/events";

export const ACCESS_TOKEN_KEY = "sciagent_token";

interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  role?: string;
}

interface RegisterRequest {
  username?: string;
  email?: string;
  password: string;
}

interface AuthMeResponse {
  username: string;
  role?: string;
}

interface TopicListResponse {
  items: TopicSummary[];
  total: number;
}

interface MessageListResponse {
  messages: Message[];
}

interface ApproveRunRequest {
  module: AgentId;
  approved: boolean;
  note?: string;
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`[${status}] ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 10_000;

let unauthorizedHandler: (() => void) | null = null;
let unauthorizedNotified = false;

export const setUnauthorizedHandler = (handler: (() => void) | null): void => {
  unauthorizedHandler = handler;
};

const triggerUnauthorized = (): void => {
  clearAccessToken();

  if (unauthorizedNotified) {
    return;
  }

  unauthorizedNotified = true;
  unauthorizedHandler?.();

  queueMicrotask(() => {
    unauthorizedNotified = false;
  });
};

export const getBackendBaseUrl = (): string => {
  const configured = import.meta.env.VITE_BACKEND_BASE_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim().replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const rawHost = window.location.hostname?.trim() || "localhost";
    const host = rawHost === "0.0.0.0" ? "localhost" : rawHost;
    return `${protocol}//${host}:8000`;
  }

  return DEFAULT_BACKEND_BASE_URL;
};

export const getAccessToken = (): string | null => {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

export const setAccessToken = (token: string): void => {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
};

export const clearAccessToken = (): void => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
};

const buildUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getBackendBaseUrl()}${normalizedPath}`;
};

const parseErrorDetail = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as {
      detail?: string;
      error?: { message?: string };
    };

    if (typeof data.detail === "string" && data.detail.length > 0) {
      return data.detail;
    }

    if (data.error && typeof data.error.message === "string" && data.error.message.length > 0) {
      return data.error.message;
    }
  } catch {
    // Ignore parse errors and fallback to status text.
  }

  return response.statusText || "Request failed";
};

const request = async (path: string, options: RequestOptions = {}): Promise<Response> => {
  const headers = new Headers(options.headers ?? {});

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(path), {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      if (response.status === 401 && !options.skipAuth) {
        triggerUnauthorized();
      }
      throw new ApiError(response.status, detail);
    }

    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `[timeout] Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${options.method ?? "GET"} ${path}`,
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Network request failed");
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const apiFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const response = await request(path, options);

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const apiFetchText = async (path: string, options: RequestOptions = {}): Promise<Response> => {
  return request(path, options);
};

export const login = async (username: string, password: string): Promise<LoginResponse> => {
  return apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    skipAuth: true,
  });
};

export const register = async (payload: RegisterRequest): Promise<LoginResponse> => {
  return apiFetch<LoginResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
};

export const getAuthMe = async (): Promise<AuthMeResponse> => {
  return apiFetch<AuthMeResponse>("/api/auth/me", {
    method: "GET",
  });
};

export const validateAccessToken = async (): Promise<boolean> => {
  if (!getAccessToken()) {
    return false;
  }

  try {
    await getAuthMe();
    return true;
  } catch {
    return false;
  }
};

export const getTopics = async (): Promise<TopicSummary[]> => {
  const response = await apiFetch<TopicListResponse>("/api/topics", {
    method: "GET",
  });
  return response.items;
};

export const createTopic = async (name: string, description = ""): Promise<TopicDetail> => {
  return apiFetch<TopicDetail>("/api/topics", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
};

export const deleteTopic = async (topicId: string): Promise<void> => {
  await apiFetch<void>(`/api/topics/${topicId}`, {
    method: "DELETE",
  });
};

export const getSnapshot = async (topicId: string, limit = 200): Promise<SnapshotResponse> => {
  return apiFetch<SnapshotResponse>(`/api/topics/${topicId}/snapshot?limit=${limit}`, {
    method: "GET",
  });
};

export const getDefaultRunConfig = async (): Promise<RunConfig> => {
  return apiFetch<RunConfig>("/api/config/default", {
    method: "GET",
  });
};

export const startRun = async (
  topicId: string,
  payload: { prompt?: string; config?: RunConfig } = {},
): Promise<RunCreateResponse> => {
  const body = {
    prompt: payload.prompt ?? "",
    ...(payload.config ? { config: payload.config } : {}),
  };

  return apiFetch<RunCreateResponse>(`/api/topics/${topicId}/runs`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export const getRun = async (runId: string): Promise<RunDetail> => {
  return apiFetch<RunDetail>(`/api/runs/${runId}`, {
    method: "GET",
  });
};

export const approveRun = async (
  runId: string,
  payload: ApproveRunRequest,
): Promise<{ ok: boolean }> => {
  return apiFetch<{ ok: boolean }>(`/api/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const sendAgentCommand = async (
  topicId: string,
  agentId: AgentId,
  text: string,
): Promise<{ ok: boolean }> => {
  return apiFetch<{ ok: boolean }>(`/api/topics/${topicId}/agents/${agentId}/command`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
};

export const fetchArtifactContent = async (
  artifactUri: string,
): Promise<{ content: string; contentType: string }> => {
  const response = await apiFetchText(artifactUri, {
    method: "GET",
  });

  return {
    content: await response.text(),
    contentType: response.headers.get("Content-Type") ?? "text/plain",
  };
};

export const getAgentMessages = async (topicId: string, agentId: AgentId): Promise<Message[]> => {
  const response = await apiFetch<MessageListResponse>(
    `/api/topics/${topicId}/agents/${agentId}/messages`,
    {
      method: "GET",
    },
  );
  return response.messages;
};

export const postAgentMessage = async (
  topicId: string,
  agentId: AgentId,
  content: string,
): Promise<Message[]> => {
  const response = await apiFetch<MessageListResponse>(
    `/api/topics/${topicId}/agents/${agentId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
  return response.messages;
};

export const getTopicTrace = async (topicId: string, runId?: string): Promise<TraceResponse> => {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  return apiFetch<TraceResponse>(`/api/topics/${topicId}/trace${query}`, {
    method: "GET",
  });
};

export const getAdminOverview = async (): Promise<AdminMetricsPayload> => {
  return apiFetch<AdminMetricsPayload>("/api/admin/overview", {
    method: "GET",
  });
};
