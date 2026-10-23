export const TOP_VIEWS = [
  "rooms",
  "protocols",
  "assets",
  "noticeboard",
  "instruments",
  "printing",
  "history",
  "minigames",
] as const;

export type TopView = (typeof TOP_VIEWS)[number];

export type Route =
  | { view: "rooms" }
  | { view: "containers"; roomId: string }
  | { view: "detail"; roomId: string; containerId: string; rack: string | null; box: string | null }
  | { view: TopView };

export function parseHash(hash: string): Route {
  if (!hash || hash === "#" || hash === "#rooms") {
    return { view: "rooms" };
  }
  if (hash.startsWith("#containers/")) {
    const parts = hash.split("/");
    return { view: "containers", roomId: parts[1] ?? "" };
  }
  if (hash.startsWith("#detail/")) {
    const parts = hash.split("/");
    const route: Route = {
      view: "detail",
      roomId: parts[1] ?? "",
      containerId: parts[2] ?? "",
      rack: null,
      box: null,
    };
    if (parts.length >= 5 && parts[3] === "rack" && parts[4]) {
      route.rack = decodeURIComponent(parts[4]);
      if (parts.length >= 7 && parts[5] === "box" && parts[6]) {
        route.box = decodeURIComponent(parts[6]);
      }
    }
    return route;
  }
  const viewName = hash.replace("#", "");
  if ((TOP_VIEWS as readonly string[]).includes(viewName)) {
    return { view: viewName as TopView };
  }
  return { view: "rooms" };
}

let route = $state<Route>(parseHash(window.location.hash));

window.addEventListener("hashchange", () => {
  route = parseHash(window.location.hash);
});

export const router = {
  get route(): Route {
    return route;
  },
};

export function navigateTo(view: "rooms"): void;
export function navigateTo(view: "containers", ids: { roomId: string }): void;
export function navigateTo(
  view: "detail",
  ids: { roomId: string; containerId: string; rack?: string | null; box?: string | null },
): void;
export function navigateTo(view: TopView): void;
export function navigateTo(
  view: string,
  ids?: { roomId?: string; containerId?: string; rack?: string | null; box?: string | null },
): void {
  if (view === "rooms") {
    window.location.hash = "#rooms";
  } else if (view === "containers") {
    window.location.hash = `#containers/${ids?.roomId ?? ""}`;
  } else if (view === "detail") {
    let hash = `#detail/${ids?.roomId ?? ""}/${ids?.containerId ?? ""}`;
    if (ids?.rack) {
      hash += `/rack/${encodeURIComponent(ids.rack)}`;
      if (ids.box) {
        hash += `/box/${encodeURIComponent(ids.box)}`;
      }
    }
    window.location.hash = hash;
  } else if ((TOP_VIEWS as readonly string[]).includes(view)) {
    window.location.hash = `#${view}`;
  }
}
