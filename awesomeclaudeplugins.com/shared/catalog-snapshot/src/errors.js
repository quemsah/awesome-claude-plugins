export class CatalogSnapshotError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = this.constructor.name
  }
}

export class IncompatibleSchemaError extends CatalogSnapshotError {}
export class CorruptedSnapshotError extends CatalogSnapshotError {}
export class SnapshotMismatchError extends CatalogSnapshotError {}
export class InvalidSnapshotInputError extends CatalogSnapshotError {}
export class MarkdownPathCollisionError extends InvalidSnapshotInputError {}
