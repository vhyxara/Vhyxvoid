import { AppError } from "@/core/errors/app-error";

/**
 * 404 - Resource Not Found
 * Use when: Database record doesn't exist.
 */
export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found") {
    super(message, 404, "NOT_FOUND");
  }
}

/**
 * 409 - Conflict / Duplicate
 * Use when: Email is taken, Username exists, or Unique constraint fails.
 */

export class ConflictError extends AppError {
  constructor(message = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

// 1. Unauthorized / Authentication Required (401)
export class ValidationError extends AppError {
  constructor(message = "Invalid request data") {
    super(message, 400, "VALIDATION_ERROR");
  }
}
/**
 * 401 - Missing or Invalid Token
 * Use when: JWT is missing, expired, or tampered with.
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required: please log in") {
    super(message, 401, "UNAUTHORIZED");
  }
}

// 2. Forbidden / Unauthorized Action (403)
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
}

// 3. Plan Limit Exceeded (402)
export class PlanLimitExceededError extends AppError {
  constructor(details: {
    limit: number;
    current: number;
    limitKey: string;
    plan: string;
  }) {
    super("Plan limit reached", 402, "FORBIDDEN");
    this.details = details;
  }

  public details: any;
}

// 4. Resource In Use / Dependency Block (400 or 409)
// Use 400 (Bad Request) if the client needs to change state first
export class ResourceInUseError extends AppError {
  constructor(
    message = "This resource is currently in use and cannot be modified or deleted",
  ) {
    super(message, 409, "CONFLICT");
  }
}

// For Step 1: Account is frozen/suspended
export class InactiveError extends AppError {
  constructor(
    message = "This resource is currently inactive, suspended, or revoked",
  ) {
    super(message, 403, "FORBIDDEN");
  }
}

// For Step 2 & 4: Permissions/Scopes
export class AccessDeniedError extends AppError {
  constructor(
    message = "Access denied: insufficient permissions or scope violation",
  ) {
    super(message, 403, "FORBIDDEN");
  }
}

export class InternalServerError extends AppError {
  constructor(message = "Internal server error") {
    super(message, 500, "INTERNAL_ERROR", false);
  }
}
