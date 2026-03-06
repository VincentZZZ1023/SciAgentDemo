import { getAccessToken, getBackendBaseUrl } from "./client";
import { parseWsEvent, type Event } from "../types/events";

export type WsStatus = "connecting" | "connected" | "reconnecting" | "closed";

interface WsCallbacks {
  onEvent: (event: Event) => void;
  onStatusChange?: (status: WsStatus) => void;
  onError?: (message: string) => void;
}

interface TopicWsOptions extends WsCallbacks {
  topicId: string;
}

interface AdminWsOptions extends WsCallbacks {}

export interface TopicWsConnection {
  close: () => void;
}

const buildWsBase = (): URL => {
  const url = new URL(getBackendBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  return url;
};

const buildTopicWsUrl = (topicId: string, token: string): string => {
  const url = buildWsBase();
  url.pathname = "/api/ws";
  url.searchParams.set("topicId", topicId);
  url.searchParams.set("token", token);
  return url.toString();
};

const buildAdminWsUrl = (token: string): string => {
  const url = buildWsBase();
  url.pathname = "/api/admin/ws";
  url.searchParams.set("token", token);
  return url.toString();
};

const connectWithAutoReconnect = (
  urlBuilder: (token: string) => string,
  callbacks: WsCallbacks,
): TopicWsConnection => {
  const token = getAccessToken();
  if (!token) {
    callbacks.onStatusChange?.("closed");
    callbacks.onError?.("Missing access token");
    return {
      close: () => {
        callbacks.onStatusChange?.("closed");
      },
    };
  }

  let stopped = false;
  let reconnectAttempts = 0;
  let reconnectTimer: number | undefined;
  let socket: WebSocket | null = null;

  const scheduleReconnect = () => {
    if (stopped) {
      return;
    }

    const delay = Math.min(1000 * 2 ** reconnectAttempts, 5000);
    reconnectAttempts += 1;
    callbacks.onStatusChange?.("reconnecting");

    reconnectTimer = window.setTimeout(() => {
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) {
      return;
    }

    callbacks.onStatusChange?.(reconnectAttempts > 0 ? "reconnecting" : "connecting");

    socket = new WebSocket(urlBuilder(token));

    socket.onopen = () => {
      reconnectAttempts = 0;
      callbacks.onStatusChange?.("connected");
    };

    socket.onmessage = (message) => {
      if (typeof message.data !== "string") {
        return;
      }

      try {
        const raw = JSON.parse(message.data) as unknown;
        const event = parseWsEvent(raw);
        if (!event) {
          callbacks.onError?.("Ignored WS message: schema mismatch");
          return;
        }
        callbacks.onEvent(event);
      } catch {
        callbacks.onError?.("Ignored WS message: invalid JSON");
      }
    };

    socket.onerror = () => {
      callbacks.onError?.("WebSocket error");
    };

    socket.onclose = () => {
      if (stopped) {
        callbacks.onStatusChange?.("closed");
        return;
      }

      scheduleReconnect();
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close();
      }
      callbacks.onStatusChange?.("closed");
    },
  };
};

export const connectTopicWs = (options: TopicWsOptions): TopicWsConnection => {
  return connectWithAutoReconnect(
    (token) => buildTopicWsUrl(options.topicId, token),
    options,
  );
};

export const connectAdminWs = (options: AdminWsOptions): TopicWsConnection => {
  return connectWithAutoReconnect(buildAdminWsUrl, options);
};

