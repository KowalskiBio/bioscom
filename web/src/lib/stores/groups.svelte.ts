import { api } from "../api";

export interface GroupInfo {
  id: string;
  name: string;
  created: number;
}

let groups = $state<GroupInfo[]>([]);
let loaded = $state(false);

export const groupList = {
  get items(): GroupInfo[] {
    return groups;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function fetchGroups(): Promise<void> {
  const body = await api.get<{ groups: GroupInfo[] }>("/api/groups");
  groups = body.groups;
  loaded = true;
}

export function clearGroups(): void {
  groups = [];
  loaded = false;
}
