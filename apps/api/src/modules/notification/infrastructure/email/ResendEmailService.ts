// src/modules/notifications/infrastructure/email/ResendEmailService.ts

import { Resend } from "resend";
import type {
  IEmailService,
  SendEmailParams,
} from "@/modules/notification/domain/services/IEmailService.notification";

export class ResendEmailService implements IEmailService {
  private readonly client: Resend;
  private readonly defaultFrom: string;

  constructor(config: { apiKey: string; defaultFrom: string }) {
    this.client = new Resend(config.apiKey);
    this.defaultFrom = config.defaultFrom;
  }

  async send(params: SendEmailParams): Promise<{ id: string }> {
    const to = Array.isArray(params.to) ? params.to : [params.to];
    const recipients =
      process.env.NODE_ENV === "development"
        ? [process.env.DEV_EMAIL ?? "tanveerbranded10@gmail.com"]
        : to;

    const result = await this.client.emails.send({
      from: params.from ?? this.defaultFrom,
      to: recipients,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo,
    });

    if (result.error) {
      throw new Error(
        `Resend error: ${result.error.message} (${result.error.name})`,
      );
    }

    return { id: result.data?.id ?? "" };
  }
}

export function buildEmailService(): ResendEmailService {
  const apiKey = process.env.RESEND_API_KEY;
  const defaultFrom = process.env.EMAIL_FROM ?? "App <noreply@example.com>";

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY environment variable.");
  }

  return new ResendEmailService({ apiKey, defaultFrom });
}
