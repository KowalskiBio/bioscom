import { api, ApiError } from "./api";
import { currentGroup } from "./stores/currentGroup.svelte";
import { session, setUser } from "./stores/session.svelte";
import { showToast } from "./stores/toast.svelte";
import type { ChessBoard } from "./chess";

const gid = (): string => {
  const id = currentGroup.groupId;
  if (id === null) {
    throw new ApiError(400, "No lab selected");
  }
  return id;
};

async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : label, "error");
    return false;
  }
}

export function opCreateNotice(body: { title: string; content: string; category: string }): Promise<boolean> {
  return run("Failed to create notice", () => api.post("/api/notices", body));
}

export function opUpdateNotice(id: string, body: { title?: string; content?: string; category?: string }): Promise<boolean> {
  return run("Failed to update notice", () => api.put(`/api/notices/${id}`, body));
}

export function opDeleteNotice(id: string): Promise<boolean> {
  return run("Failed to delete notice", () => api.del(`/api/notices/${id}`));
}

export function opAddReaction(noticeId: string, text: string): Promise<boolean> {
  return run("Failed to react", () => api.post(`/api/notices/${noticeId}/reactions`, { text }));
}

export function opDeleteReaction(noticeId: string, reactionId: string): Promise<boolean> {
  return run("Failed to remove reaction", () => api.del(`/api/notices/${noticeId}/reactions/${reactionId}`));
}

export function opCreateInstrument(body: {
  name: string;
  description?: string;
  location: string;
  contactPerson?: string;
  contactEmail?: string;
}): Promise<boolean> {
  return run("Failed to add instrument", () => api.post("/api/instruments", body));
}

export function opUpdateInstrument(
  id: string,
  body: { name?: string; description?: string; location?: string; contactPerson?: string; contactEmail?: string },
): Promise<boolean> {
  return run("Failed to save instrument", () => api.put(`/api/instruments/${id}`, body));
}

export function opDeleteInstrument(id: string): Promise<boolean> {
  return run("Failed to delete instrument", () => api.del(`/api/instruments/${id}`));
}

export function opBookInstrument(
  id: string,
  body: { date: string; startTime: string; endTime: string; note?: string },
): Promise<boolean> {
  return run("Failed to book instrument", () => api.post(`/api/instruments/${id}/bookings`, body));
}

export function opCancelBooking(instrumentId: string, bookingId: string): Promise<boolean> {
  return run("Failed to cancel booking", () => api.del(`/api/instruments/${instrumentId}/bookings/${bookingId}`));
}

export function opCreateCatalogItem(body: {
  name: string;
  description?: string;
  category?: string;
  material?: string;
  estimatedTime?: string;
  image?: string;
}): Promise<boolean> {
  return run("Failed to add catalog item", () => api.post("/api/print/catalog", body));
}

export function opUpdateCatalogItem(
  id: string,
  body: { name?: string; description?: string; category?: string; material?: string; estimatedTime?: string; image?: string },
): Promise<boolean> {
  return run("Failed to save catalog item", () => api.put(`/api/print/catalog/${id}`, body));
}

export function opDeleteCatalogItem(id: string): Promise<boolean> {
  return run("Failed to delete catalog item", () => api.del(`/api/print/catalog/${id}`));
}

export function opCreatePrintRequest(body: {
  catalogItemId?: string;
  catalogItemName?: string;
  customDesign?: boolean;
  note?: string;
  quantity?: number;
}): Promise<boolean> {
  return run("Failed to request print", () => api.post("/api/print/requests", body));
}

export function opSetPrintStatus(id: string, status: string): Promise<boolean> {
  return run("Failed to update status", () => api.post(`/api/print/requests/${id}/status`, { status }));
}

export function opCreateGame(gameType: "chess" | "frog", opponentUid: string): Promise<boolean> {
  return run("Failed to send challenge", () => api.post("/api/games", { gameType, opponentUid }));
}

export function opChessMove(gameId: string, board: ChessBoard, turn: "white" | "black"): Promise<boolean> {
  return run("Failed to move", () => api.post(`/api/games/${gameId}/chess-move`, { board, turn }));
}

export function opFrogAnswer(gameId: string, round: number, score: number): Promise<boolean> {
  return run("Failed to submit answer", () => api.post(`/api/games/${gameId}/frog-answer`, { round, score }));
}

export function opFinishGame(gameId: string, winnerUid?: string): Promise<boolean> {
  return run("Failed to finish game", () => api.post(`/api/games/${gameId}/finish`, { winnerUid }));
}

export function opCreateManualBackup(): Promise<boolean> {
  return run("Failed to create backup", () => api.post(`/api/groups/${gid()}/backups`));
}

export function opRestoreBackup(backupId: string): Promise<boolean> {
  return run("Failed to restore backup", () =>
    api.post(`/api/groups/${gid()}/backups/${backupId}/restore`),
  );
}

export function opUpdateProfile(body: { name?: string; avatar?: string }): Promise<boolean> {
  return run("Failed to save profile", async () => {
    const result = await api.put<{ user: { uid: string; name: string; role: string; groupId: string | null; email: string | null } }>(
      "/api/users/me",
      body,
    );
    setUser({ ...session.user!, name: result.user.name });
  });
}

export function opAdminSetRole(uid: string, role: string): Promise<boolean> {
  return run("Failed to change role", () => api.put(`/api/admin/users/${uid}/role`, { role }));
}

export function opAdminDeleteUser(uid: string): Promise<boolean> {
  return run("Failed to delete user", () => api.del(`/api/admin/users/${uid}`));
}
