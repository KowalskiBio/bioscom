let groupId = $state<string | null>(null);
let groupName = $state<string | null>(null);

export const currentGroup = {
  get groupId(): string | null {
    return groupId;
  },
  get groupName(): string | null {
    return groupName;
  },
};

export function setCurrentGroup(id: string | null, name: string | null = null): void {
  groupId = id;
  groupName = name;
}

export function clearCurrentGroup(): void {
  groupId = null;
  groupName = null;
}
