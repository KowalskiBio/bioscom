const STORAGE_KEY = "bioscom-theme";

export function initTheme(): void {
  if (localStorage.getItem(STORAGE_KEY) === "lite") {
    document.body.classList.add("lite-mode");
  } else {
    document.body.classList.remove("lite-mode");
  }
}

export function toggleTheme(): void {
  document.body.classList.toggle("lite-mode");
  const isLite = document.body.classList.contains("lite-mode");
  localStorage.setItem(STORAGE_KEY, isLite ? "lite" : "dark");
}
