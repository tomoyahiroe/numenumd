export type KeyHandler = (ev: KeyboardEvent) => boolean;

export class KeyRouter {
  private handlers: { priority: number; handler: KeyHandler }[] = [];

  register(priority: number, handler: KeyHandler): () => void {
    const entry = { priority, handler };
    this.handlers.push(entry);
    this.handlers.sort((a, b) => a.priority - b.priority);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== entry);
    };
  }

  route(ev: KeyboardEvent): boolean {
    for (const { handler } of this.handlers) {
      if (handler(ev)) return true;
    }
    return false;
  }
}
