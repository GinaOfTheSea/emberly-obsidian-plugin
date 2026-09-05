/** Serializes structural writes per map and reserves rename/move destinations. */
export class MapOperationQueue {
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly destinations = new Set<string>();

  run<T>(mapId: string, action: () => Promise<T>): Promise<T> {
    const result = (this.writes.get(mapId) ?? Promise.resolve()).then(action);
    const tail = result.catch(() => undefined);
    this.writes.set(mapId, tail);
    void tail.then(() => { if (this.writes.get(mapId) === tail) this.writes.delete(mapId); });
    return result;
  }

  runMany<T>(ids: string[], action: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(ids)].sort();
    const enter = (position: number): Promise<T> => position === ordered.length ? action()
      : this.run(ordered[position]!, () => enter(position + 1));
    return enter(0);
  }

  destinationReserved(key: string): boolean { return this.destinations.has(key); }
  reserveDestination(key: string): void { this.destinations.add(key); }
  releaseDestination(key: string): void { this.destinations.delete(key); }

  dispose(): void {
    this.destinations.clear();
    this.writes.clear();
  }
}
