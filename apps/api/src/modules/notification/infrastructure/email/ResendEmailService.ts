// src/modules/notifications/infrastructure/email/ResendEmailService.ts

import { Resend } from "resend";
import { ConsoleEmailService } from "./ConsoleEmailService";
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
    // In development, DEV_EMAIL (if set) receives every email instead of the
    // real recipient. No hardcoded fallback address: without DEV_EMAIL,
    // development without a Resend key uses ConsoleEmailService instead.
    const recipients =
      process.env.NODE_ENV === "development" && process.env.DEV_EMAIL
        ? [process.env.DEV_EMAIL]
        : to;

    const from = params.from ?? this.defaultFrom;

    if (!from.includes("vhyxvoid.com")) {
      throw new Error("Invalid FROM domain");
    }

    const result = await this.client.emails.send({
      // from: params.from ?? this.defaultFrom,
      from,
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

    // return { id: result.data?.id ?? "" };
    if (!result.data?.id) {
      throw new Error("Email sent but no ID returned");
    }

    return { id: result.data.id };
  }
}

export function buildEmailService(): IEmailService {
  const apiKey = process.env.RESEND_API_KEY;
  const production = process.env.NODE_ENV === "production";
  const defaultFrom =
    process.env.EMAIL_FROM ??
    (production ? undefined : "VhyxVoid <no-reply@send.vhyxvoid.com>");

  if (!defaultFrom) {
    throw new Error("Missing EMAIL_FROM environment variable.");
  }

  if (!apiKey) {
    // Production must send real email; anywhere else, print it.
    if (production) {
      throw new Error("Missing RESEND_API_KEY environment variable.");
    }
    return new ConsoleEmailService(defaultFrom);
  }

  return new ResendEmailService({ apiKey, defaultFrom });
}
