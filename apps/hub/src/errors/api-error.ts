export class ApiError extends Error {
  public statusCode: number;
  constructor(statusCode = 500, message = "Internal Server Error") {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}
