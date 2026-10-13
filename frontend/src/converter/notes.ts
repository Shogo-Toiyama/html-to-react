// Records what the converter changed, so participants can read why in
// CONVERSION.md. Repeated changes of one kind are merged and counted.

export type NoteKind = 'change' | 'check'

export interface Note {
  kind: NoteKind
  title: string
  detail: string
  count: number
  /** Specific places, e.g. `index.html: <a href="about.html">`. */
  examples: string[]
}

const MAX_EXAMPLES = 5

export class NoteCollector {
  private notes = new Map<string, Note>()

  add(kind: NoteKind, title: string, detail: string, example?: string) {
    const key = `${kind}:${title}`
    let note = this.notes.get(key)
    if (!note) {
      note = { kind, title, detail, count: 0, examples: [] }
      this.notes.set(key, note)
    }
    note.count += 1
    if (example && note.examples.length < MAX_EXAMPLES && !note.examples.includes(example)) {
      note.examples.push(example)
    }
  }

  change(title: string, detail: string, example?: string) {
    this.add('change', title, detail, example)
  }

  check(title: string, detail: string, example?: string) {
    this.add('check', title, detail, example)
  }

  list(kind?: NoteKind): Note[] {
    const all = [...this.notes.values()]
    return kind ? all.filter((note) => note.kind === kind) : all
  }
}
