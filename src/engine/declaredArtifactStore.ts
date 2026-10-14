import type { ModuleManifest } from "@/engine/moduleManifest";

/** Restrict one module to cloned, declared artifacts and prevent nested edits leaking upstream. */
export function declaredArtifactStore(
  manifest: ModuleManifest,
  store: Record<string, unknown>,
  optionalFallbacks: Set<string>,
  log: (message: string) => void = () => {},
): Readonly<Record<string, unknown>> {
  const required = new Set(Object.keys(manifest.consumes));
  const optional = new Set(Object.keys(manifest.optionalConsumes));
  const allowed = new Set([...required, ...optional]);
  const snapshot = Object.assign(Object.create(null), structuredClone(Object.fromEntries(
    [...allowed].filter((key) => Object.hasOwn(store, key)).map((key) => [key, store[key]]),
  ))) as Record<string, unknown>;
  const assertAllowed = (property: PropertyKey): string | null => {
    if (typeof property === "symbol") return null;
    const key = String(property);
    if (!allowed.has(key)) {
      throw new Error(
        `module "${manifest.id}" attempted undeclared artifact read "${key}"; add it to consumes/optionalConsumes`,
      );
    }
    return key;
  };
  return new Proxy(snapshot, {
    get(target, property, receiver) {
      const key = assertAllowed(property);
      if (key === null) return Reflect.get(target, property, receiver);
      if (optional.has(key) && !Reflect.has(target, key) && !optionalFallbacks.has(key)) {
        optionalFallbacks.add(key);
        log(`module ${manifest.id}: optional artifact "${key}" absent; deterministic fallback recorded`);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      const key = assertAllowed(property);
      return key === null ? Reflect.has(target, property) : Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...allowed].filter((key) => Reflect.has(target, key));
    },
    getOwnPropertyDescriptor(target, property) {
      const key = assertAllowed(property);
      return key === null
        ? Reflect.getOwnPropertyDescriptor(target, property)
        : Reflect.getOwnPropertyDescriptor(target, key);
    },
    set() {
      throw new Error(`module "${manifest.id}" attempted to mutate the read-only artifact store`);
    },
    deleteProperty() {
      throw new Error(`module "${manifest.id}" attempted to delete from the read-only artifact store`);
    },
    defineProperty() {
      throw new Error(`module "${manifest.id}" attempted to redefine the read-only artifact store`);
    },
    setPrototypeOf() {
      throw new Error(`module "${manifest.id}" attempted to change the read-only artifact store prototype`);
    },
    preventExtensions() {
      throw new Error(`module "${manifest.id}" attempted to seal the read-only artifact store`);
    },
  });
}
