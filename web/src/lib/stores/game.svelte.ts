import type { GameChallenge } from "@bioscom/shared";
import { api } from "../api";

let games = $state<GameChallenge[]>([]);
let loaded = $state(false);

export const gameList = {
  get items(): GameChallenge[] {
    return games;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function fetchGames(): Promise<void> {
  const body = await api.get<{ games: GameChallenge[] }>("/api/games");
  games = body.games;
  loaded = true;
}

export function clearGames(): void {
  games = [];
  loaded = false;
}
