export class LocalWriteGuard {
  private readonly pendingUntil = new Map<string, number>();
  private readonly expected = new Map<string, Set<string>>();
  private readonly properties = new Map<string, Set<string>>();

  constructor(private readonly durationMs = 2_000) {}

  mark(path: string, now = Date.now()): void {
    this.prune(now);
    this.pendingUntil.set(path, now + this.durationMs);
  }

  has(path: string, now = Date.now()): boolean {
    const until = this.pendingUntil.get(path);
    if (until === undefined) return false;
    if (until > now) return true;
    this.pendingUntil.delete(path);
    this.expected.delete(path);
    this.properties.delete(path);
    return false;
  }

  clear(): void {
    this.pendingUntil.clear();
    this.expected.clear();
    this.properties.clear();
  }

  forget(path: string): void {
    this.pendingUntil.delete(path);
    this.expected.delete(path);
    this.properties.delete(path);
  }

  expect(path: string, content: string): void {
    this.mark(path);
    const contents = this.expected.get(path) ?? new Set<string>();
    contents.add(content);
    this.expected.set(path, contents);
  }

  /** Registered inside processFrontMatter, before Obsidian publishes metadata. */
  expectProperties(path: string, properties: Record<string, unknown>): void {
    this.mark(path);
    const values = this.properties.get(path) ?? new Set<string>();
    values.add(propertySignature(properties));
    this.properties.set(path, values);
  }

  matches(path: string, content: string, properties?: Record<string, unknown>): boolean {
    if (!this.has(path)) return false;
    return Boolean(this.expected.get(path)?.has(content)
      || (properties && this.properties.get(path)?.has(propertySignature(properties))));
  }

  private prune(now: number): void {
    for (const [path, until] of this.pendingUntil) {
      if (until <= now) this.forget(path);
    }
  }
}

function propertySignature(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(propertySignature).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${propertySignature(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
