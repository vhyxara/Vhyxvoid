import { PrismaClient } from "@/generated/prisma";
import {
  Feedback,
  FeedbackProps,
} from "../../domain/entities/Feedback.entities";
import {
  FeedbackRepository,
  FeedbackListOptions,
} from "../../domain/repositories/Feedback.repositories";

export class PrismaFeedbackRepository implements FeedbackRepository {
  constructor(private prisma: PrismaClient) {}

  async save(feedback: Feedback): Promise<void> {
    const p = feedback.toPersistence();
    await this.prisma.feedback.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        userId: p.userId,
        accountId: p.accountId,
        type: p.type,
        status: p.status,
        priority: p.priority,
        title: p.title,
        description: p.description,
        stepsToReproduce: p.stepsToReproduce,
        expectedBehavior: p.expectedBehavior,
        actualBehavior: p.actualBehavior,
        pageUrl: p.pageUrl,
        userAgent: p.userAgent,
        appVersion: p.appVersion,
        attachments: p.attachments,
        adminNotes: p.adminNotes,
        resolvedAt: p.resolvedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
      update: {
        status: p.status,
        priority: p.priority,
        adminNotes: p.adminNotes,
        resolvedAt: p.resolvedAt,
        updatedAt: p.updatedAt,
      },
    });
  }

  async findById(id: string): Promise<Feedback | null> {
    const row = await this.prisma.feedback.findUnique({ where: { id } });
    return row ? Feedback.rehydrate(row as FeedbackProps) : null;
  }

  async findByUserId(
    userId: string,
    options: FeedbackListOptions = {},
  ): Promise<{ items: Feedback[]; total: number }> {
    const { page = 1, limit = 20, status, type, priority } = options;

    const where = {
      userId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(priority ? { priority } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return {
      items: rows.map((r) => Feedback.rehydrate(r as FeedbackProps)),
      total,
    };
  }

  async findAll(
    options: FeedbackListOptions = {},
  ): Promise<{ items: Feedback[]; total: number }> {
    const { page = 1, limit = 20, status, type, priority } = options;

    const where = {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(priority ? { priority } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return {
      items: rows.map((r) => Feedback.rehydrate(r as FeedbackProps)),
      total,
    };
  }
}
