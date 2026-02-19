import { getAccessToken, getBackendBaseUrl } from "./client";
import { parseWsEvent, type Event } from "../types/events";

export type WsStatus = "connecting" | "connected" | "reconnecting" | "closed";

interface TopicWsOptions {
  topicId: string;
  onEvent: (event: Event) => void;
  onStatusChange?: (status: WsStatus) => void;
  onError?: (message: string) => void;
}

export interface TopicWsConnection {
  close: () => void;
}

const buildWsUrl = (topicId: string, token: string): string => {
  const url = new URL(getBackendBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/ws";
  url.search = "";
  url.searchParams.set("topicId", topicId);
  url.searchParams.set("token", token);
  return url.toString();
};

export const connectTopicWs = (options: TopicWsOptions): TopicWsConnection => {
  const token = getAccessToken();
  if (!token) {
    options.onStatusChange?.("closed");
    options.onError?.("Missing access token");
    return {
      close: () => {
        options.onStatusChange?.("closed");
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
    options.onStatusChange?.("reconnecting");

    reconnectTimer = window.setTimeout(() => {
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) {
      return;
    }

    options.onStatusChange?.(reconnectAttempts > 0 ? "reconnecting" : "connecting");

    socket = new WebSocket(buildWsUrl(options.topicId, token));

    socket.onopen = () => {
      reconnectAttempts = 0;
      options.onStatusChange?.("connected");
    };

    socket.onmessage = (message) => {
      if (typeof message.data !== "string") {
        return;
      }

      try {
        const raw = JSON.parse(message.data) as unknown;
        const event = parseWsEvent(raw);
        if (!event) {
          options.onError?.("Ignored WS message: schema mismatch");
          return;
        }
        options.onEvent(event);
      } catch {
        options.onError?.("Ignored WS message: invalid JSON");
      }
    };

    socket.onerror = () => {
      options.onError?.("WebSocket error");
    };

    socket.onclose = () => {
      if (stopped) {
        options.onStatusChange?.("closed");
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
      options.onStatusChange?.("closed");
    },
  };
};
