// src/modules/notifications/infrastructure/email/templates/index.ts
// Typed email template builders — no HTML string soup.
// Each function returns { subject, html, text } ready to pass to IEmailService.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// ── Shared layout ─────────────────────────────────────────────────────────────

const APP_NAME = process.env.APP_NAME ?? "VhyxVoid";
const APP_URL = process.env.APP_URL ?? "https://www.vhyxvoid.com";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@vhyxvoid.com";

function layout(content: string, preheader = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_NAME}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}&nbsp;&zwnj;</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 0;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <a href="${APP_URL}" style="text-decoration:none;">
                <span style="font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.5px;">${APP_NAME}</span>
              </a>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 0;color:#9ca3af;font-size:13px;line-height:1.5;">
              <p style="margin:0 0 4px;">
                &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
              </p>
              <p style="margin:0;">
                Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#6366f1;text-decoration:none;">${SUPPORT_EMAIL}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
    <tr>
      <td style="border-radius:8px;background:#4f46e5;">
        <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>
      </td>
    </tr>
  </table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#111827;line-height:1.3;">${text}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${text}</p>`;
}

function smallNote(text: string): string {
  return `<p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.5;">${text}</p>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:20px 0;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
    <code style="font-size:28px;font-weight:700;letter-spacing:8px;color:#111827;font-family:'Courier New',monospace;">${code}</code>
  </div>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * Email verification on registration
 */
export function emailVerification(params: {
  firstName: string;
  verifyUrl: string; // full URL with token e.g. https://app/verify?token=xxx
  expiresInHours?: number;
}): EmailContent {
  const subject = `Verify your email — ${APP_NAME}`;
  const html = layout(
    heading("Verify your email address") +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `You're almost set! Click the button below to verify your email address and activate your ${APP_NAME} account.`,
      ) +
      button("Verify Email Address", params.verifyUrl) +
      smallNote(
        `This link expires in ${params.expiresInHours ?? 24} hours. ` +
          `If you didn't create an account, you can safely ignore this email.`,
      ),
    "Verify your email to get started",
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Please verify your email address by visiting:\n${params.verifyUrl}\n\n` +
    `This link expires in ${params.expiresInHours ?? 24} hours.\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Account invitation email
 */
export function accountInvitation(params: {
  inviterName: string;
  accountName: string;
  inviteUrl: string; // full URL with token
  roleLabel: string; // 'Admin' | 'Member'
  expiresInDays?: number;
}): EmailContent {
  const subject = `${params.inviterName} invited you to ${params.accountName}`;
  const html = layout(
    heading(`You're invited to join ${params.accountName}`) +
      para(
        `<strong>${params.inviterName}</strong> has invited you to join <strong>${params.accountName}</strong> as a <strong>${params.roleLabel}</strong>.`,
      ) +
      button("Accept Invitation", params.inviteUrl) +
      smallNote(
        `This invitation expires in ${params.expiresInDays ?? 3} days. ` +
          `If you weren't expecting this, you can ignore this email.`,
      ),
    `${params.inviterName} invited you to ${params.accountName}`,
  );
  const text =
    `${params.inviterName} has invited you to join ${params.accountName} as a ${params.roleLabel}.\n\n` +
    `Accept the invitation: ${params.inviteUrl}\n\n` +
    `This invitation expires in ${params.expiresInDays ?? 3} days.\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Payment failed — account is entering grace period
 */
export function paymentFailed(params: {
  firstName: string;
  accountName: string;
  amountFormatted: string; // e.g. '$49.00'
  billingPortalUrl: string;
  graceEndsAt: Date;
}): EmailContent {
  const graceDateStr = params.graceEndsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Action required: payment failed for ${params.accountName}`;
  const html = layout(
    heading("Your payment failed") +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `We were unable to process your payment of <strong>${params.amountFormatted}</strong> for ` +
          `<strong>${params.accountName}</strong>. Your account will remain active until <strong>${graceDateStr}</strong>, ` +
          `after which it will be suspended.`,
      ) +
      button("Update Payment Method", params.billingPortalUrl) +
      smallNote(
        "If you have already updated your payment method, please allow a few minutes for the payment to process.",
      ),
    "Please update your payment method to avoid service interruption",
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `We were unable to process your payment of ${params.amountFormatted} for ${params.accountName}.\n\n` +
    `Your account will remain active until ${graceDateStr}. Please update your payment method:\n` +
    `${params.billingPortalUrl}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Payment succeeded — subscription renewed
 */
export function paymentSucceeded(params: {
  firstName: string;
  accountName: string;
  amountFormatted: string;
  invoiceUrl: string;
  periodEnd: Date;
}): EmailContent {
  const nextBillingStr = params.periodEnd.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Payment confirmed — ${params.accountName}`;
  const html = layout(
    heading("Payment confirmed") +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `Your payment of <strong>${params.amountFormatted}</strong> for <strong>${params.accountName}</strong> ` +
          `was processed successfully. Your next billing date is <strong>${nextBillingStr}</strong>.`,
      ) +
      button("View Invoice", params.invoiceUrl) +
      smallNote("Thank you for using " + APP_NAME + "."),
    `Your payment of ${params.amountFormatted} was successful`,
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Your payment of ${params.amountFormatted} for ${params.accountName} was processed successfully.\n\n` +
    `View your invoice: ${params.invoiceUrl}\n\n` +
    `Next billing date: ${nextBillingStr}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Subscription canceled
 */
export function subscriptionCanceled(params: {
  firstName: string;
  accountName: string;
  accessEndsAt: Date;
  resubscribeUrl: string;
}): EmailContent {
  const accessEndStr = params.accessEndsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Your ${APP_NAME} subscription has been canceled`;
  const html = layout(
    heading("Subscription canceled") +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `Your subscription for <strong>${params.accountName}</strong> has been canceled. ` +
          `You'll continue to have access until <strong>${accessEndStr}</strong>.`,
      ) +
      para(
        "We'd love to have you back. You can resubscribe anytime before your access ends to keep your data and settings.",
      ) +
      button("Resubscribe", params.resubscribeUrl) +
      smallNote(`Questions? Reply to this email or contact ${SUPPORT_EMAIL}.`),
    `Your access continues until ${accessEndStr}`,
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Your subscription for ${params.accountName} has been canceled.\n\n` +
    `You'll have access until ${accessEndStr}.\n\n` +
    `To resubscribe: ${params.resubscribeUrl}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Trial ending soon
 */
export function trialEnding(params: {
  firstName: string;
  accountName: string;
  trialEndsAt: Date;
  upgradeUrl: string;
  daysLeft: number;
}): EmailContent {
  const trialEndStr = params.trialEndsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Your ${APP_NAME} trial ends in ${params.daysLeft} day${params.daysLeft === 1 ? "" : "s"}`;
  const html = layout(
    heading(
      `Your trial ends ${params.daysLeft === 1 ? "tomorrow" : `in ${params.daysLeft} days`}`,
    ) +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `Your free trial for <strong>${params.accountName}</strong> ends on <strong>${trialEndStr}</strong>. ` +
          `Add a payment method now to keep full access without interruption.`,
      ) +
      button("Add Payment Method", params.upgradeUrl) +
      smallNote(
        "No action needed if you choose not to continue — your account will be automatically downgraded to the free plan.",
      ),
    `Trial ends ${trialEndStr} — add a payment method to continue`,
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Your trial for ${params.accountName} ends on ${trialEndStr} (${params.daysLeft} day${params.daysLeft === 1 ? "" : "s"} left).\n\n` +
    `Add a payment method: ${params.upgradeUrl}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Member joined your organization (notify owner)
 */
export function memberJoined(params: {
  ownerFirstName: string;
  newMemberName: string;
  newMemberEmail: string;
  accountName: string;
  roleLabel: string;
  membersUrl: string;
}): EmailContent {
  const subject = `${params.newMemberName} joined ${params.accountName}`;
  const html = layout(
    heading(`New member joined ${params.accountName}`) +
      para(`Hi ${params.ownerFirstName || "there"},`) +
      para(
        `<strong>${params.newMemberName}</strong> (${params.newMemberEmail}) has accepted their invitation ` +
          `and joined <strong>${params.accountName}</strong> as a <strong>${params.roleLabel}</strong>.`,
      ) +
      button("View Team", params.membersUrl),
    `${params.newMemberName} joined your team`,
  );
  const text =
    `Hi ${params.ownerFirstName || "there"},\n\n` +
    `${params.newMemberName} (${params.newMemberEmail}) has joined ${params.accountName} as a ${params.roleLabel}.\n\n` +
    `View your team: ${params.membersUrl}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Password reset request email
 */
export function passwordResetRequest(params: {
  firstName: string;
  resetUrl: string;
  expiresInHours?: number;
}): EmailContent {
  const subject = `Reset your ${APP_NAME} password`;
  const html = layout(
    heading("Reset your password") +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `We received a request to reset your password. Click the button below to choose a new one.`,
      ) +
      button("Reset Password", params.resetUrl) +
      smallNote(
        `This link expires in ${params.expiresInHours ?? 1} hour. ` +
          `If you didn't request a password reset, you can safely ignore this email — your password won't change.`,
      ),
    "Reset your password",
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `We received a request to reset your password.\n\n` +
    `Reset your password by visiting:\n${params.resetUrl}\n\n` +
    `This link expires in ${params.expiresInHours ?? 1} hour.\n\n` +
    `If you didn't request this, ignore this email.\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Password reset success confirmation
 */
export function passwordResetSuccess(params: {
  firstName: string;
}): EmailContent {
  const subject = `Your ${APP_NAME} password has been changed`;
  const html = layout(
    heading("Password changed successfully") +
      para(`Hi ${params.firstName || "there"},`) +
      para(
        `Your password has been changed successfully. You've been logged out of all devices for security.`,
      ) +
      para(
        "If you did not make this change, please contact support immediately.",
      ) +
      button("Contact Support", `mailto:${SUPPORT_EMAIL}`) +
      smallNote(`This is an automated security notification from ${APP_NAME}.`),
    "Your password was changed",
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Your password has been changed successfully.\n\n` +
    `If you did not make this change, contact support immediately: ${SUPPORT_EMAIL}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}
