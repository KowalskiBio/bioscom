import { connection } from "./stores/connection.svelte";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

const AUTH_PATHS = ["/api/login", "/api/register", "/api/forgot-password", "/api/reset-password"];

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== "GET" && !connection.connected && connection.everConnected) {
    throw new ApiError(503, "You are offline – changes are disabled until the connection returns.");
  }
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown = undefined;
  if (res.status !== 204) {
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
  }
  if (res.status === 401) {
    if (!AUTH_PATHS.some((authPath) => path === authPath)) {
      unauthorizedHandler?.();
    }
    const message =
      parsed !== null && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : "Not authenticated";
    throw new ApiError(401, message, parsed);
  }
  if (!res.ok) {
    const message =
      parsed !== null && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};
