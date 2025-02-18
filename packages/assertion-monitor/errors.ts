export class AssertionDataError extends Error {
  constructor(message: string, public readonly rawData?: any) {
    super(message)
    this.name = 'AssertionDataError'
  }
}
