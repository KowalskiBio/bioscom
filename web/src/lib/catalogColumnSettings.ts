import type { CatalogColumnScope } from "@bioscom/shared";
import CatalogColumnsModal from "../components/modals/CatalogColumnsModal.svelte";
import { openModal } from "./modal.svelte";

export function openCatalogColumnSettings(initialScope: CatalogColumnScope = "all"): void {
  openModal({
    title: "Package columns",
    component: CatalogColumnsModal,
    props: { initialScope },
    btnText: null,
    size: "wide",
  });
}
