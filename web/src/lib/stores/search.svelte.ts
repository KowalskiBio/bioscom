let query = $state("");

export const searchState = {
  get query(): string {
    return query;
  },
  set(next: string): void {
    query = next;
  },
  clear(): void {
    query = "";
  },
};
