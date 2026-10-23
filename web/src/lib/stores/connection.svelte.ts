let connected = $state(false);
let everConnected = $state(false);
let unauthenticated = $state(false);

export const connection = {
  get connected(): boolean {
    return connected;
  },
  get everConnected(): boolean {
    return everConnected;
  },
  get offline(): boolean {
    return everConnected && !connected;
  },
  get unauthenticated(): boolean {
    return unauthenticated;
  },
};

export function setConnected(value: boolean): void {
  connected = value;
  if (value) {
    everConnected = true;
    unauthenticated = false;
  }
}

export function setUnauthenticated(): void {
  unauthenticated = true;
}

export function resetConnection(): void {
  connected = false;
  everConnected = false;
  unauthenticated = false;
}
