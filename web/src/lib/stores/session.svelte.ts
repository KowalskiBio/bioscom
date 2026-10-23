export interface SessionUser {
  uid: string;
  name: string;
  role: string;
  groupId: string | null;
  email: string | null;
}

let user = $state<SessionUser | null>(null);
let loaded = $state(false);

export const session = {
  get user(): SessionUser | null {
    return user;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function loadSession(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    if (res.ok) {
      const body = (await res.json()) as { user: SessionUser };
      user = body.user;
    } else {
      user = null;
    }
  } catch {
    user = null;
  } finally {
    loaded = true;
  }
}

export function setUser(nextUser: SessionUser | null): void {
  user = nextUser;
}

export function clearSession(): void {
  user = null;
}
