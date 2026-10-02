export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "You do not have permission to do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(message = "This record was changed by someone else. Reload and try again.") {
    super(message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION";
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED";
  constructor(message = "Please sign in.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}
