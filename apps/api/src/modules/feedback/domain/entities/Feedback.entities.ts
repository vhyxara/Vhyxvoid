import {
  FeedbackType,
  FeedbackStatus,
  FeedbackPriority,
} from "@/generated/prisma";

export interface FeedbackProps {
  id: string;
  userId: string;
  accountId: string | null;
  type: FeedbackType;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  title: string;
  description: string;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  appVersion: string | null;
  attachments: string[];
  adminNotes: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Feedback {
  private constructor(private props: FeedbackProps) {}

  static create(params: {
    userId: string;
    accountId?: string | null;
    type: FeedbackType;
    title: string;
    description: string;
    stepsToReproduce?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    pageUrl?: string | null;
    userAgent?: string | null;
    appVersion?: string | null;
    attachments?: string[];
  }): Feedback {
    const now = new Date();

    if (!params.title || params.title.trim().length < 3) {
      throw new Error("Title must be at least 3 characters");
    }
    if (!params.description || params.description.trim().length < 10) {
      throw new Error("Description must be at least 10 characters");
    }

    return new Feedback({
      id: crypto.randomUUID(),
      userId: params.userId,
      accountId: params.accountId ?? null,
      type: params.type,
      status: FeedbackStatus.OPEN,
      priority: FeedbackPriority.MEDIUM,
      title: params.title.trim(),
      description: params.description.trim(),
      stepsToReproduce: params.stepsToReproduce?.trim() ?? null,
      expectedBehavior: params.expectedBehavior?.trim() ?? null,
      actualBehavior: params.actualBehavior?.trim() ?? null,
      pageUrl: params.pageUrl ?? null,
      userAgent: params.userAgent ?? null,
      appVersion: params.appVersion ?? null,
      attachments: params.attachments ?? [],
      adminNotes: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: FeedbackProps): Feedback {
    return new Feedback(props);
  }

  // ── Getters ───────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get accountId(): string | null {
    return this.props.accountId;
  }
  get type(): FeedbackType {
    return this.props.type;
  }
  get status(): FeedbackStatus {
    return this.props.status;
  }
  get priority(): FeedbackPriority {
    return this.props.priority;
  }
  get title(): string {
    return this.props.title;
  }
  get description(): string {
    return this.props.description;
  }
  get stepsToReproduce(): string | null {
    return this.props.stepsToReproduce;
  }
  get expectedBehavior(): string | null {
    return this.props.expectedBehavior;
  }
  get actualBehavior(): string | null {
    return this.props.actualBehavior;
  }
  get pageUrl(): string | null {
    return this.props.pageUrl;
  }
  get userAgent(): string | null {
    return this.props.userAgent;
  }
  get appVersion(): string | null {
    return this.props.appVersion;
  }
  get attachments(): string[] {
    return this.props.attachments;
  }
  get adminNotes(): string | null {
    return this.props.adminNotes;
  }
  get resolvedAt(): Date | null {
    return this.props.resolvedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get isOpen(): boolean {
    return this.props.status === FeedbackStatus.OPEN;
  }
  get isResolved(): boolean {
    return this.props.status === FeedbackStatus.RESOLVED;
  }

  // ── Business Logic ────────────────────────────────────────

  updateStatus(status: FeedbackStatus, now: Date): void {
    this.props.status = status;
    this.props.updatedAt = now;
    if (status === FeedbackStatus.RESOLVED) {
      this.props.resolvedAt = now;
    }
  }

  updatePriority(priority: FeedbackPriority, now: Date): void {
    this.props.priority = priority;
    this.props.updatedAt = now;
  }

  addAdminNote(note: string, now: Date): void {
    this.props.adminNotes = note.trim();
    this.props.updatedAt = now;
  }

  // ── Persistence ───────────────────────────────────────────

  toPersistence(): FeedbackProps {
    return { ...this.props };
  }
}
