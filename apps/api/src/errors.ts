export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class SeatUnavailableError extends AppError {
  constructor() {
    super(409, 'No seat left in this class - the last seat was taken by another booking', 'SEAT_UNAVAILABLE');
    this.name = 'SeatUnavailableError';
  }
}

export class DuplicateBookingError extends AppError {
  constructor() {
    super(409, 'This child already has an active booking for this class', 'DUPLICATE_BOOKING');
    this.name = 'DuplicateBookingError';
  }
}

export function isUniqueConstraintError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && (code.startsWith('SQLITE_CONSTRAINT') || code === '23505')) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
