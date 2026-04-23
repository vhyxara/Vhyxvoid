import { Prisma, PrismaClient } from "@/generated/prisma";
import { User } from "@/modules/identity/domain/entities/user/User.entities";
import { UserRepository } from "@/modules/identity/domain/repositories/user/User.repositories";

type PrismaTransactionalClient = PrismaClient | Prisma.TransactionClient;
export class PrismaUserRepository implements UserRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(user: User): Promise<void> {
    const p = user.toPersistence();
    await this.prisma.user.upsert({
      where: { id: p.id },
      update: {
        email: p.email,
        password: p.passwordHash,
        firstName: p.firstName,
        lastName: p.lastName,
        isEmailVerified: p.isEmailVerified,
        failedLoginAttempts: p.failedLoginAttempts,
        lockedUntil: p.lockedUntil,
        status: p.status,
        deletedAt: p.deletedAt,
        tokenVersion: p.tokenVersion,
        updatedAt: p.updatedAt,
      },
      create: {
        id: p.id,
        email: p.email,
        password: p.passwordHash,
        firstName: p.firstName,
        lastName: p.lastName,
        isEmailVerified: p.isEmailVerified,
        failedLoginAttempts: p.failedLoginAttempts,
        lockedUntil: p.lockedUntil,
        status: p.status,
        deletedAt: p.deletedAt,
        tokenVersion: p.tokenVersion,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    // if (!data) return null;

    // return User.rehydrate({
    //   id: data.id,
    //   email: data.email,
    //   passwordHash: data.password,
    //   isEmailVerified: data.isEmailVerified,
    //   createdAt: data.createdAt,
    //   updatedAt: data.updatedAt,
    //   failedLoginAttempts: data.failedLoginAttempts,
    //   lockedUntil: data.lockedUntil,
    //   status: data.status,
    //   tokenVersion: data.tokenVersion,
    // });
    return data ? this.toEntity(data) : null;
  }

  // async findById(id: string): Promise<User | null> {
  //   const data = await this.prisma.user.findUnique({ where: { id } });
  //   if (!data) return null;

  //   return User.rehydrate({
  //     id: data.id,
  //     email: data.email,
  //     passwordHash: data.password,
  //     isEmailVerified: data.isEmailVerified,
  //     createdAt: data.createdAt,
  //     updatedAt: data.updatedAt,
  //     failedLoginAttempts: data.failedLoginAttempts,
  //     lockedUntil: data.lockedUntil,
  //     status: data.status,
  //     tokenVersion: data.tokenVersion,
  //   });
  // }
  async findById(id: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({ where: { id } });
    return data ? this.toEntity(data) : null;
  }

  async findAll(filters?: {
    status?: boolean;
    isDeleted?: boolean;
  }): Promise<User[]> {
    const where: Prisma.UserWhereInput = {};
    if (filters?.isDeleted === true) where.deletedAt = { not: null };
    if (filters?.isDeleted === false) where.deletedAt = null;
    if (filters?.status !== undefined) where.status = filters.status;
    const data = await this.prisma.user.findMany({ where });
    return data.map((d) => this.toEntity(d));
  }

  async countTotal(): Promise<number> {
    return this.prisma.user.count();
  }

  private toEntity(data: any): User {
    return User.rehydrate({
      id: data.id,
      email: data.email,
      passwordHash: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      isEmailVerified: data.isEmailVerified,
      failedLoginAttempts: data.failedLoginAttempts,
      lockedUntil: data.lockedUntil,
      status: data.status,
      deletedAt: data.deletedAt,
      tokenVersion: data.tokenVersion,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }
}
