// src/modules/notification/infrastructure/email/ConsoleEmailService.ts
//
// Development/test transport: prints each email (recipient, subject, text and
// every link in it) to stdout instead of sending it. Chosen by
// buildEmailService() outside production when no Resend key is configured, so
// a local stack works without a real email account and never mails a real
// inbox by accident.

import { randomUUID } from "crypto";
import type {
  IEmailService,
  SendEmailParams,
} from "@/modules/notification/domain/services/IEmailService.notification";

export class ConsoleEmailService implements IEmailService {
  constructor(private readonly defaultFrom: string) {}

  async send(params: SendEmailParams): Promise<{ id: string }> {
    const id = `console_${randomUUID()}`;
    const links = [...params.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.info(
      "[email:console]",
      JSON.stringify({
        id,
        from: params.from ?? this.defaultFrom,
        to: params.to,
        subject: params.subject,
        links: [...new Set(links)],
        text: params.text,
      }),
    );
    return { id };
  }
}
