const THEME_KEY = "bioscom-theme";
const DESIGN_KEY = "bioscom-design";

export type DesignTheme = "original" | "bauhaus";

function readStoredDesign(): DesignTheme {
  try {
    return localStorage.getItem(DESIGN_KEY) === "bauhaus" ? "bauhaus" : "original";
  } catch {
    return "original";
  }
}

let designState = $state<DesignTheme>(readStoredDesign());

export const theme = {
  get design(): DesignTheme {
    return designState;
  },
};

function applyDesign(design: DesignTheme): void {
  designState = design;
  document.body.dataset.design = design;
}

export function setDesign(design: DesignTheme): void {
  applyDesign(design);
  localStorage.setItem(DESIGN_KEY, design);
}

export function initTheme(): void {
  if (localStorage.getItem(THEME_KEY) === "lite") {
    document.body.classList.add("lite-mode");
  } else {
    document.body.classList.remove("lite-mode");
  }
  applyDesign(localStorage.getItem(DESIGN_KEY) === "bauhaus" ? "bauhaus" : "original");
}

export function toggleTheme(): void {
  document.body.classList.toggle("lite-mode");
  const isLite = document.body.classList.contains("lite-mode");
  localStorage.setItem(THEME_KEY, isLite ? "lite" : "dark");
}
