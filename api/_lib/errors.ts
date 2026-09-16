export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

// Thrown by a stage handler. Carries whatever raw/partial data is useful
// for debugging (e.g. the malformed JSON a model returned) so it can be
// written into events.detail without ever being written to the row it
// was meant to produce.
export class StageError extends Error {
  raw?: unknown;
  constructor(message: string, raw?: unknown) {
    super(message);
    this.raw = raw;
    this.name = "StageError";
  }
}
