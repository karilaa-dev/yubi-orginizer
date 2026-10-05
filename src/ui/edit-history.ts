interface Edit<T> { before: T; after: T }

/** In-memory edit history. Call breakGroup() when a continuous input gesture ends. */
export class EditHistory<T> {
  readonly #equals: (a: T, b: T) => boolean;
  readonly #limit: number;
  readonly #past: Edit<T>[] = [];
  readonly #future: Edit<T>[] = [];
  #group: string | undefined;

  constructor(equals: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer.');
    this.#equals = equals;
    this.#limit = limit;
  }

  get canUndo(): boolean { return this.#past.length > 0; }
  get canRedo(): boolean { return this.#future.length > 0; }

  record(before: T, after: T, group?: string): void {
    // A redundant input event must not erase a redo branch.
    if (this.#equals(before, after)) return;
    const edit = { before: structuredClone(before), after: structuredClone(after) };
    const previous = this.#past.at(-1);
    this.#future.length = 0;
    if (group !== undefined && group === this.#group && previous && this.#equals(previous.after, edit.before)) {
      previous.after = edit.after;
      if (this.#equals(previous.before, previous.after)) {
        this.#past.pop();
        this.breakGroup();
      }
      return;
    }
    this.#past.push(edit);
    if (this.#past.length > this.#limit) this.#past.shift();
    this.#group = group;
  }

  breakGroup(): void { this.#group = undefined; }

  clear(): void {
    this.#past.length = 0;
    this.#future.length = 0;
    this.breakGroup();
  }

  undo(): T | undefined {
    this.breakGroup();
    const edit = this.#past.pop();
    if (!edit) return undefined;
    this.#future.push(edit);
    return structuredClone(edit.before);
  }

  redo(): T | undefined {
    this.breakGroup();
    const edit = this.#future.pop();
    if (!edit) return undefined;
    this.#past.push(edit);
    return structuredClone(edit.after);
  }
}
