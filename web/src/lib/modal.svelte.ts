import type { Component } from "svelte";

type AnyComponent = Component<any>;

export type ModalSize = "default" | "wide" | "xwide";

export interface ModalState {
  open: boolean;
  title: string;
  bodyHtml: string;
  component: AnyComponent | null;
  props: Record<string, unknown>;
  btnText: string | null;
  onConfirm: (() => void) | null;
  size?: ModalSize;
}

let state = $state.raw<ModalState>({
  open: false,
  title: "",
  bodyHtml: "",
  component: null,
  props: {},
  btnText: null,
  onConfirm: null,
  size: "default",
});

export const modal = {
  get state(): ModalState {
    return state;
  },
};

export interface OpenModalOptions {
  title: string;
  bodyHtml?: string;
  component?: AnyComponent | null;
  props?: Record<string, unknown>;
  btnText?: string | null;
  onConfirm?: (() => void) | null;
  size?: ModalSize;
}

export function openModal(options: OpenModalOptions): void {
  state = {
    open: true,
    title: options.title,
    bodyHtml: options.bodyHtml ?? "",
    component: options.component ?? null,
    props: options.props ?? {},
    btnText: options.btnText ?? null,
    onConfirm: options.onConfirm ?? null,
    size: options.size ?? "default",
  };
  setTimeout(() => {
    const first = document.querySelector("#modal-body input, #modal-body select, #modal-body textarea");
    if (first instanceof HTMLElement) {
      first.focus();
    }
  }, 100);
}

export function closeModal(): void {
  state = {
    open: false,
    title: "",
    bodyHtml: "",
    component: null,
    props: {},
    btnText: null,
    onConfirm: null,
    size: "default",
  };
}

export function openLegacyModal(
  title: string,
  bodyHtml: string,
  btnText: string | null,
  onConfirm: (() => void) | null,
): void {
  openModal({ title, bodyHtml, btnText, onConfirm });
}
