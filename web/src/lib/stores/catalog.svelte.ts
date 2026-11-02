import { api } from "../api";
import { currentGroup } from "./currentGroup.svelte";
import { showToast } from "./toast.svelte";

export interface MaterialCounts {
  products: number;
  batches: number;
  stocks: number;
  locations: number;
}

export interface CatalogMaterial {
  id: string;
  groupId: string;
  type: string;
  name: string;
  description: string | null;
  attributes: Record<string, string | number | boolean | null>;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  counts: MaterialCounts;
}

export interface CatalogProduct {
  id: string;
  manufacturer: string | null;
  supplier: string | null;
  catalogNumber: string | null;
  productName: string | null;
  variant: string | null;
  attributes: Record<string, string | number | boolean | null>;
}

export interface CatalogBatch {
  id: string;
  productId: string | null;
  lotCode: string | null;
  originType: string;
  receivedAt: number | null;
  preparedAt: number | null;
  preparedBy: string | null;
  expiresAt: number | null;
  product: { manufacturer: string | null; catalogNumber: string | null; productName: string | null } | null;
}

export interface CatalogStockLocation {
  id: string;
  name: string;
  rackName: string | null;
  boxName: string | null;
  containerId: string | null;
  containerName: string | null;
  roomId: string | null;
  roomName: string | null;
  path: string;
}

export interface CatalogStock {
  id: string;
  name: string;
  type: string;
  quantity: number | null;
  unit: string | null;
  concentration: number | null;
  concentrationUnit: string | null;
  note: string | null;
  status: string;
  position: string | null;
  customPosition: string | null;
  location: CatalogStockLocation;
  batch: {
    id: string;
    lotCode: string | null;
    originType: string;
    expiresAt: number | null;
    receivedAt: number | null;
    preparedAt: number | null;
  };
  product: { id: string; manufacturer: string | null; catalogNumber: string | null; productName: string | null } | null;
  materialId: string;
  attributes: Record<string, string | number | boolean | null>;
}

export interface CatalogDetail {
  material: CatalogMaterial;
  products: CatalogProduct[];
  batches: CatalogBatch[];
  stocks: CatalogStock[];
}

interface CatalogPage {
  materials: CatalogMaterial[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 25;

let items = $state<CatalogMaterial[]>([]);
let total = $state(0);
let page = $state(1);
let query = $state("");
let typeFilter = $state("");
let loading = $state(false);
let loaded = $state(false);
let loadedGroupId = $state<string | null>(null);
let detail = $state<CatalogDetail | null>(null);
let detailLoading = $state(false);
let pageRequest = 0;
let detailRequest = 0;

export const catalog = {
  get items(): CatalogMaterial[] {
    return items;
  },
  get total(): number {
    return total;
  },
  get page(): number {
    return page;
  },
  get query(): string {
    return query;
  },
  get typeFilter(): string {
    return typeFilter;
  },
  get loading(): boolean {
    return loading;
  },
  get loaded(): boolean {
    return loaded;
  },
  get loadedGroupId(): string | null {
    return loadedGroupId;
  },
  get detail(): CatalogDetail | null {
    return detail;
  },
  get detailLoading(): boolean {
    return detailLoading;
  },
  fetchCatalog,
  fetchMaterialDetail,
  setQuery,
  setTypeFilter,
  clearCatalog,
};

export function setQuery(value: string): void {
  query = value;
}

export function setTypeFilter(value: string): void {
  typeFilter = value;
}

export async function fetchCatalog(page_ = 1): Promise<boolean> {
  const groupId = currentGroup.groupId;
  if (groupId === null) {
    return false;
  }
  const requestId = ++pageRequest;
  loading = true;
  try {
    const params = new URLSearchParams({ page: String(page_), limit: String(PAGE_SIZE) });
    if (typeFilter !== "") {
      params.set("type", typeFilter);
    }
    if (query.trim() !== "") {
      params.set("q", query.trim());
    }
    const body = await api.get<CatalogPage>(
      `/api/groups/${encodeURIComponent(groupId)}/materials?${params.toString()}`,
    );
    if (requestId !== pageRequest) {
      return false;
    }
    items = body.materials;
    total = body.total;
    page = body.page;
    loaded = true;
    loadedGroupId = groupId;
    return true;
  } catch {
    if (requestId === pageRequest) {
      showToast("Failed to load catalog", "error");
    }
    return false;
  } finally {
    if (requestId === pageRequest) {
      loading = false;
    }
  }
}

export async function fetchMaterialDetail(id: string): Promise<boolean> {
  const groupId = currentGroup.groupId;
  if (groupId === null) {
    return false;
  }
  const requestId = ++detailRequest;
  detail = null;
  detailLoading = true;
  try {
    const body = await api.get<CatalogDetail>(
      `/api/groups/${encodeURIComponent(groupId)}/materials/${encodeURIComponent(id)}`,
    );
    if (requestId !== detailRequest) {
      return false;
    }
    detail = body;
    return true;
  } catch {
    if (requestId === detailRequest) {
      showToast("Failed to load material", "error");
    }
    return false;
  } finally {
    if (requestId === detailRequest) {
      detailLoading = false;
    }
  }
}

export function clearCatalog(): void {
  pageRequest += 1;
  detailRequest += 1;
  items = [];
  total = 0;
  page = 1;
  query = "";
  typeFilter = "";
  loading = false;
  loaded = false;
  loadedGroupId = null;
  detail = null;
  detailLoading = false;
}
