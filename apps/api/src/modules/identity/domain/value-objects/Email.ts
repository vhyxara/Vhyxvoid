// // identity/domain/value-objects/Email.ts

// export class Email {
//   private readonly value: string;

//   private constructor(value: string) {
//     this.value = value;
//   }

//   static create(raw: string): Email {
//     if (!raw) {
//       throw new Error("Email is required");
//     }

//     const normalized = raw.trim().toLowerCase();

//     const emailRegex =
//       /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//     if (!emailRegex.test(normalized)) {
//       throw new Error("Invalid email format");
//     }

//     return new Email(normalized);
//   }

//   getValue(): string {
//     return this.value;
//   }

//   equals(other: Email): boolean {
//     return this.value === other.value;
//   }
// }

export class Email {
  #value: string;
  private constructor(value: string) {
    this.#value = value;
  }

  static create(email: string): Email {
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Invalid email');
    return new Email(email.toLowerCase().trim());
  }

  get value() {
    return this.#value;
  }
}
