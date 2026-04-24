// src/modules/notifications/domain/services/IEmailService.ts
// Abstract interface for email delivery.
// Use cases depend on this — never on Resend SDK directly.
// Concrete: infrastructure/email/ResendEmailService.ts

export interface SendEmailParams {
  to: string | string[]; // recipient(s)
  subject: string;
  html: string; // full HTML body (from template builder)
  text?: string; // plain text fallback
  from?: string; // defaults to env EMAIL_FROM
  replyTo?: string;
}

export interface IEmailService {
  send(params: SendEmailParams): Promise<{ id: string }>;
}
