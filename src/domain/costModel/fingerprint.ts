// src/domain/costModel/fingerprint.ts

function stableStringify(obj: any): string {
  const seen = new WeakSet();

  const sorter = (value: any): any => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.map(sorter);

    const keys = Object.keys(value).sort();
    const out: any = {};
    for (const k of keys) out[k] = sorter(value[k]);
    return out;
  };

  return JSON.stringify(sorter(obj));
}

function simpleHash(str: string): string {
  // FNV-1a-ish 32bit (deterministic, fast)
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function buildFingerprint(payload: any): string {
  return simpleHash(stableStringify(payload));
}
