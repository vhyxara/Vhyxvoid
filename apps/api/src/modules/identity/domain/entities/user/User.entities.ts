// identity/domain/entities/User.ts

import { UnauthorizedError } from "@/core/errors/error.format";

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  tokenVersion: number;
}

export class User {
  // Private fields
  // #id: string;
  // #email: string;
  // #passwordHash: string;
  // #isEmailVerified: boolean;
  // #failedLoginAttempts: number;
  // #lockedUntil: Date | null;
  // #status: boolean;
  // #createdAt: Date;
  // #updatedAt: Date;
  // #tokenVersion: number;

  // private constructor(props: UserProps) {
  //   this.#id = props.id;
  //   this.#email = props.email;
  //   this.#passwordHash = props.passwordHash;
  //   this.#isEmailVerified = props.isEmailVerified;
  //   this.#failedLoginAttempts = props.failedLoginAttempts;
  //   this.#lockedUntil = props.lockedUntil;
  //   this.#status = props.status;
  //   this.#createdAt = props.createdAt;
  //   this.#updatedAt = props.updatedAt;
  //   this.#tokenVersion = props.tokenVersion;
  // }
  private constructor(private props: UserProps) {}

  // ── Factories ──────────────────────────────────────────────

  static register(params: {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
  }): User {
    const now = new Date();
    return new User({
      id: crypto.randomUUID(),
      email: params.email.toLowerCase().trim(),
      passwordHash: params.passwordHash,
      firstName: params.firstName?.trim() ?? "",
      lastName: params.lastName?.trim() ?? "",
      isEmailVerified: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      status: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      tokenVersion: 0,
    });
  }

  static rehydrate(props: UserProps): User {
    return new User(props);
  }

  // ── Getters ────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get email(): string {
    return this.props.email;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get firstName(): string {
    return this.props.firstName;
  }
  get lastName(): string {
    return this.props.lastName;
  }
  get fullName(): string {
    return `${this.props.firstName} ${this.props.lastName}`.trim();
  }
  get isEmailVerified(): boolean {
    return this.props.isEmailVerified;
  }
  get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }
  get lockedUntil(): Date | null {
    return this.props.lockedUntil;
  }
  get status(): boolean {
    return this.props.status;
  }
  get tokenVersion(): number {
    return this.props.tokenVersion;
  }
  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  // ── Business Logic ─────────────────────────────────────────

  ensureCanLogin(now: Date): void {
    if (this.props.deletedAt) {
      throw new UnauthorizedError("Account has been deleted");
    }
    if (!this.props.status) {
      throw new UnauthorizedError("Account is disabled");
    }
    if (this.props.lockedUntil && this.props.lockedUntil > now) {
      const minutesLeft = Math.ceil(
        (this.props.lockedUntil.getTime() - now.getTime()) / 60_000,
      );
      throw new UnauthorizedError(
        `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`,
      );
    }
  }

  verifyEmail(now: Date): void {
    this.props.isEmailVerified = true;
    this.props.updatedAt = now;
  }

  recordFailedLoginAttempt(now: Date): void {
    this.props.failedLoginAttempts += 1;
    // Lock after 5 consecutive failures — 15 min lockout
    if (this.props.failedLoginAttempts >= 5) {
      this.props.lockedUntil = new Date(now.getTime() + 15 * 60 * 1_000);
    }
    this.props.updatedAt = now;
  }

  resetLoginAttempts(now: Date): void {
    this.props.failedLoginAttempts = 0;
    this.props.lockedUntil = null;
    this.props.updatedAt = now;
  }

  updateProfile(
    params: { firstName?: string; lastName?: string },
    now: Date,
  ): void {
    if (params.firstName?.trim())
      this.props.firstName = params.firstName.trim();
    if (params.lastName?.trim()) this.props.lastName = params.lastName.trim();
    this.props.updatedAt = now;
  }

  resetPassword(newPasswordHash: string, now: Date): void {
    this.props.passwordHash = newPasswordHash;
    this.props.failedLoginAttempts = 0;
    this.props.lockedUntil = null;
    this.props.tokenVersion += 1; // invalidates all existing JWTs
    this.props.updatedAt = now;
  }
  /**
   * Increment tokenVersion to invalidate ALL existing access tokens for this user.
   * Call on password change, forced logout, or suspicious activity.
   */
  incrementTokenVersion(now: Date): void {
    this.props.tokenVersion += 1;
    this.props.updatedAt = now;
  }

  disable(now: Date): void {
    this.props.status = false;
    this.props.updatedAt = now;
  }

  enable(now: Date): void {
    this.props.status = true;
    this.props.updatedAt = now;
  }

  softDelete(now: Date): void {
    this.props.deletedAt = now;
    this.props.status = false;
    this.props.updatedAt = now;
  }

  // ── Persistence ────────────────────────────────────────────

  toPersistence(): UserProps {
    return { ...this.props };
  }
}

// export class User {
//   private constructor(private props: UserProps) {}

//   // 🔹 Factory for new user registration
//   static register(params: {
//     id: string;
//     email: Email;
//     passwordHash: string;
//     now: Date;
//   }): User {
//     return new User({
//       id: params.id,
//       email: params.email,
//       passwordHash: params.passwordHash,
//       emailVerifiedAt: null,
//       failedLoginAttempts: 0,
//       lockedUntil: null,
//       createdAt: params.now,
//       updatedAt: params.now,
//     });
//   }

//   // 🔹 Rehydrate from persistence
//   static rehydrate(props: UserProps): User {
//     return new User(props);
//   }

//   // --------------------
//   // Getters
//   // --------------------

//   get id(): string {
//     return this.props.id;
//   }

//   get email(): Email {
//     return this.props.email;
//   }

//   get passwordHash(): string | null {
//     return this.props.passwordHash;
//   }

//   get emailVerifiedAt(): Date | null {
//     return this.props.emailVerifiedAt;
//   }

//   get failedLoginAttempts(): number {
//     return this.props.failedLoginAttempts;
//   }

//   get lockedUntil(): Date | null {
//     return this.props.lockedUntil;
//   }

//   // --------------------
//   // Domain Behavior
//   // --------------------

//   verifyEmail(now: Date): void {
//     if (this.props.emailVerifiedAt) {
//       return;
//     }

//     this.props.emailVerifiedAt = now;
//     this.touch(now);
//   }

//   isEmailVerified(): boolean {
//     return this.props.emailVerifiedAt !== null;
//   }

//   isLocked(now: Date): boolean {
//     if (!this.props.lockedUntil) return false;
//     return this.props.lockedUntil > now;
//   }

//   recordFailedLoginAttempt(now: Date): void {
//     this.props.failedLoginAttempts += 1;

//     if (this.props.failedLoginAttempts >= 5) {
//       const lockMinutes = 15;
//       const lockUntil = new Date(
//         now.getTime() + lockMinutes * 60 * 1000
//       );

//       this.props.lockedUntil = lockUntil;
//       this.props.failedLoginAttempts = 0; // reset after lock
//     }

//     this.touch(now);
//   }

//   recordSuccessfulLogin(now: Date): void {
//     this.props.failedLoginAttempts = 0;
//     this.props.lockedUntil = null;
//     this.touch(now);
//   }

//   ensureCanLogin(now: Date): void {
//     if (!this.passwordHash) {
//       throw new Error("Password login not available");
//     }

//     if (!this.isEmailVerified()) {
//       throw new Error("Email not verified");
//     }

//     if (this.isLocked(now)) {
//       throw new Error("Account temporarily locked");
//     }
//   }

//   private touch(now: Date): void {
//     this.props.updatedAt = now;
//   }

//   // Used by repository when persisting
//   toPersistence(): UserProps {
//     return { ...this.props };
//   }
// }
