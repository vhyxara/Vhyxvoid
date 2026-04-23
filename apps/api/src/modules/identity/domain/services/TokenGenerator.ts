// identity/domain/services/TokenGenerator.ts

export interface TokenGenerator {
  generate(): string;
  hash(raw: string): Promise<string>;
}
