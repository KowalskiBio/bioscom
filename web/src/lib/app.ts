import { api, onUnauthorized } from "./api";
import { WsClient } from "./ws";
import { createRealtimeClient, refetchAll } from "./realtime";
import { session, loadSession, clearSession, setUser, type SessionUser } from "./stores/session.svelte";
import { currentGroup, setCurrentGroup, clearCurrentGroup } from "./stores/currentGroup.svelte";
import { resetConnection } from "./stores/connection.svelte";
import { clearGroups } from "./stores/groups.svelte";
import { clearInventory, fetchInventory, fetchSharedContainers } from "./stores/inventory.svelte";
import { clearNotices } from "./stores/notices.svelte";
import { clearInstruments } from "./stores/instruments.svelte";
import { clearPrint } from "./stores/print.svelte";
import { clearGames } from "./stores/game.svelte";
import { clearHistory, fetchHistory, fetchBackups } from "./stores/history.svelte";
import { showToast } from "./stores/toast.svelte";

let ws: WsClient | null = null;

onUnauthorized(() => {
  clearSession();
});

export function startApp(): void {
  void loadSession().then(() => {
    if (session.user !== null) {
      void enterApp();
    }
  });
}

export async function enterApp(): Promise<void> {
  const user = session.user;
  if (user === null) {
    return;
  }
  if (user.groupId !== null) {
    setCurrentGroup(user.groupId);
  }
  if (ws === null) {
    ws = createRealtimeClient({
      onRefetch: () => void refetchAll(),
      onUnauthenticated: clearSession,
    });
  }
  ws.connect();
  const groupId = currentGroup.groupId;
  if (groupId !== null) {
    ws.subscribe(groupId);
    await Promise.all([
      fetchInventory(groupId),
      fetchSharedContainers(groupId),
      fetchHistory(groupId),
      fetchBackups(groupId),
    ]);
  }
  await refetchAll();
}

export function switchGroup(groupId: string, groupName: string | null): void {
  setCurrentGroup(groupId, groupName);
  ws?.subscribe(groupId);
  void Promise.all([
    fetchInventory(groupId),
    fetchSharedContainers(groupId),
    fetchHistory(groupId),
    fetchBackups(groupId),
  ]);
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const body = await api.post<{ user: SessionUser }>("/api/login", { email, password });
  setUser(body.user);
  await enterApp();
  return body.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/logout");
  } finally {
    ws?.stop();
    ws = null;
    clearSession();
    clearCurrentGroup();
    resetConnection();
    clearGroups();
    clearInventory();
    clearNotices();
    clearInstruments();
    clearPrint();
    clearGames();
    clearHistory();
    showToast("Logged out", "info");
  }
}
