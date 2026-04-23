import {
  ConflictError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from "@/core/errors/error.format";
import { Prisma } from "@/generated/prisma";

export function mapPrismaError(error: unknown): never {
  // 1. Handle Known Request Errors (Pxxxx codes)
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002": // Unique constraint failed
        const target = (error.meta?.target as string[])?.join(", ") || "field";
        throw new ConflictError(
          `A resource with this ${target} already exists.`,
        );

      case "P2003": // Foreign key constraint failed
        throw new ValidationError(
          `The related record (ID) provided does not exist in our system.`,
        );

      case "P2025": // Record to update/delete not found
        throw new NotFoundError(
          error.message || "The requested record was not found.",
        );

      case "P2000": // Value too long for column
        throw new ValidationError(
          "The provided data is too long for the database field.",
        );

      default:
        // Log the unhandled code for debugging
        console.error(`Unhandled Prisma Error Code: ${error.code}`);
        throw new InternalServerError(`Database error: ${error.code}`);
    }
  }

  // 2. Handle Validation Errors (Type mismatches)
  if (error instanceof Prisma.PrismaClientValidationError) {
    throw new ValidationError(
      "Database validation failed. Please check your data format.",
    );
  }

  // 3. Handle Connection/Initialization Errors
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    throw new InternalServerError("The database is currently unreachable.");
  }

  // 4. Fallback for everything else
  if (error instanceof Error) {
    throw new InternalServerError(error.message);
  }

  throw new InternalServerError("An unexpected database error occurred.");
}
