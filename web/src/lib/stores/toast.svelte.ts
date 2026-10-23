export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  leaving: boolean;
}

let toasts = $state<Toast[]>([]);
let nextId = 1;

export const toastList = {
  get items(): Toast[] {
    return toasts;
  },
};

export function showToast(message: string, type: ToastType = "success"): void {
  const id = nextId++;
  toasts.push({ id, message, type, leaving: false });
  setTimeout(() => {
    leaveToast(id);
  }, 2500);
}

export function leaveToast(id: number): void {
  const toast = toasts.find((t) => t.id === id);
  if (toast === undefined || toast.leaving) {
    return;
  }
  toast.leaving = true;
  setTimeout(() => {
    const index = toasts.findIndex((t) => t.id === id);
    if (index !== -1) {
      toasts.splice(index, 1);
    }
  }, 300);
}

export function clearToasts(): void {
  toasts.splice(0, toasts.length);
}
