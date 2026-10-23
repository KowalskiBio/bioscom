export interface InventoryBroadcast {
  groupId: string;
  version: number;
  tree: unknown;
}

export interface ReloadBroadcast {
  type: "reload";
  resource: "notices" | "instruments" | "games" | "history" | "print";
}

export type WsBroadcast = InventoryBroadcast | ReloadBroadcast | { error: string };

export type WsState = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "unauthenticated";

export interface WsClientOptions {
  url?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  onBroadcast?: (message: WsBroadcast) => void;
  onStateChange?: (state: WsState) => void;
  onReconnected?: () => void;
  probeSession?: () => Promise<boolean>;
}

function defaultUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

async function defaultProbeSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    return res.ok;
  } catch {
    return true;
  }
}

export class WsClient {
  private readonly opts: Required<Pick<WsClientOptions, "url" | "minDelayMs" | "maxDelayMs">> &
    WsClientOptions;
  private socket: WebSocket | null = null;
  private groupId: string | null = null;
  private attempts = 0;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: WsState = "idle";

  constructor(options: WsClientOptions = {}) {
    this.opts = {
      url: options.url ?? defaultUrl(),
      minDelayMs: options.minDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 30000,
      onBroadcast: options.onBroadcast,
      onStateChange: options.onStateChange,
      onReconnected: options.onReconnected,
      probeSession: options.probeSession ?? defaultProbeSession,
    };
  }

  connect(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.setState("connecting");
    this.open();
  }

  subscribe(groupId: string): void {
    this.groupId = groupId;
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ subscribe: groupId }));
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket !== null) {
      this.socket.close(1000, "client stop");
      this.socket = null;
    }
    this.setState("closed");
  }

  get currentState(): WsState {
    return this.state;
  }

  private open(): void {
    const socket = new WebSocket(this.opts.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      const wasReconnecting = this.attempts > 0;
      this.attempts = 0;
      this.setState("open");
      if (this.groupId !== null) {
        socket.send(JSON.stringify({ subscribe: this.groupId }));
      }
      if (wasReconnecting) {
        this.opts.onReconnected?.();
      }
    });
    socket.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.opts.onBroadcast?.(parsed as WsBroadcast);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.stopped) {
        return;
      }
      this.setState("reconnecting");
      void this.probeAndReconnect();
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private async probeAndReconnect(): Promise<void> {
    const authenticated = await this.opts.probeSession!();
    if (this.stopped) {
      return;
    }
    if (!authenticated) {
      this.stopped = true;
      this.setState("unauthenticated");
      return;
    }
    const delay = Math.min(this.opts.maxDelayMs, this.opts.minDelayMs * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        this.open();
      }
    }, delay);
  }

  private setState(state: WsState): void {
    this.state = state;
    this.opts.onStateChange?.(state);
  }
}
