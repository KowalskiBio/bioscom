import { WsClient, type WsClientOptions, type WsBroadcast } from "./ws";
import { applyBroadcast, fetchInventory } from "./stores/inventory.svelte";
import { fetchNotices } from "./stores/notices.svelte";
import { fetchInstruments } from "./stores/instruments.svelte";
import { fetchPrint } from "./stores/print.svelte";
import { fetchGames } from "./stores/game.svelte";
import { fetchHistory, fetchBackups } from "./stores/history.svelte";
import { fetchGroups } from "./stores/groups.svelte";
import { currentGroup } from "./stores/currentGroup.svelte";
import { setConnected, setUnauthenticated } from "./stores/connection.svelte";

export interface RealtimeOptions extends WsClientOptions {
  onRefetch?: () => void;
  onUnauthenticated?: () => void;
}

export function createRealtimeClient(options: RealtimeOptions = {}): WsClient {
  const { onRefetch, onUnauthenticated, ...wsOptions } = options;
  return new WsClient({
    ...wsOptions,
    onBroadcast: (message: WsBroadcast) => {
      if ("groupId" in message && typeof (message as { version?: unknown }).version === "number") {
        applyBroadcast(message as Parameters<typeof applyBroadcast>[0], currentGroup.groupId);
        return;
      }
      const reload = message as { type?: string; resource?: string };
      if (reload.type === "reload") {
        void reloadResource(reload.resource ?? "");
      }
    },
    onStateChange: (state) => {
      if (state === "open") {
        setConnected(true);
      } else if (state === "unauthenticated") {
        setConnected(false);
        setUnauthenticated();
        onUnauthenticated?.();
      } else if (state === "reconnecting" || state === "closed") {
        setConnected(false);
      }
    },
    onReconnected: () => {
      onRefetch?.();
    },
  });
}

export async function reloadResource(resource: string): Promise<void> {
  const groupId = currentGroup.groupId;
  switch (resource) {
    case "notices":
      await fetchNotices();
      break;
    case "instruments":
      await fetchInstruments();
      break;
    case "games":
      await fetchGames();
      break;
    case "print":
      await fetchPrint();
      break;
    case "history":
      if (groupId !== null) {
        await Promise.all([fetchHistory(groupId), fetchBackups(groupId)]);
      }
      break;
    default:
      break;
  }
}

export async function refetchAll(): Promise<void> {
  const groupId = currentGroup.groupId;
  await Promise.all([
    fetchGroups(),
    fetchNotices(),
    fetchInstruments(),
    fetchPrint(),
    fetchGames(),
    groupId !== null ? fetchInventory(groupId) : Promise.resolve(),
    groupId !== null ? fetchHistory(groupId) : Promise.resolve(),
  ]);
}
