import {
  FeedbackStatus,
  FeedbackType,
  FeedbackPriority,
} from "@/generated/prisma";
import { Feedback } from "../entities/Feedback.entities";

export interface FeedbackListOptions {
  page?: number;
  limit?: number;
  status?: FeedbackStatus;
  type?: FeedbackType;
  priority?: FeedbackPriority;
}

export interface FeedbackRepository {
  save(feedback: Feedback): Promise<void>;
  findById(id: string): Promise<Feedback | null>;
  findByUserId(
    userId: string,
    options?: FeedbackListOptions,
  ): Promise<{ items: Feedback[]; total: number }>;
  findAll(
    options?: FeedbackListOptions,
  ): Promise<{ items: Feedback[]; total: number }>;
}
