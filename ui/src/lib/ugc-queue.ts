// Mocks a UGC (user-generated content) queue for new place contributions.
// Persisted in localStorage — pins survive reloads until DemoResetButton clears.

export interface UgcEntry {
  id: string;
  name: string;
  address?: string;
  dish?: string;
  dietTags?: string[];
  lat: number;
  lng: number;
  createdAt: string;
  status: "pending";
}

const KEY = "tasco-ugc-queue";

export function listUgc(): UgcEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UgcEntry[];
  } catch {
    return [];
  }
}

export function enqueueUgc(
  input: Omit<UgcEntry, "id" | "createdAt" | "status">,
): UgcEntry {
  const entry: UgcEntry = {
    ...input,
    id: `ugc:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  try {
    const existing = listUgc();
    localStorage.setItem(KEY, JSON.stringify([...existing, entry]));
  } catch {
    /* ignore */
  }
  return entry;
}

export function clearUgc(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
