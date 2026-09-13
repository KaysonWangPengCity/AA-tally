const KEY = "gathering-splitter/v1";

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.friends)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clear() {
  localStorage.removeItem(KEY);
}