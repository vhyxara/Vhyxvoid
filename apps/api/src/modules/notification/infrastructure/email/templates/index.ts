// src/modules/notifications/infrastructure/email/templates/index.ts
// Typed email template builders — no HTML string soup.
// Each function returns { subject, html, text } ready to pass to IEmailService.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}


// ── Escaping ──────────────────────────────────────────────────────────────────
// Every value interpolated into HTML goes through here: names, organization
// names, feedback text and URLs are user-controlled ("<a href=…>" as an
// organization name used to render as a live link in invitation emails).
// Subjects and plain-text bodies use the raw values.

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeFields<T extends object>(params: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === "string" ? escapeHtml(v) : v;
  return out as T;
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
  const h = escapeFields(params);
  const subject = `Verify your email — ${APP_NAME}`;
  const html = layout(
    heading("Verify your email address") +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `You're almost set! Click the button below to verify your email address and activate your ${APP_NAME} account.`,
      ) +
      button("Verify Email Address", h.verifyUrl) +
      smallNote(
        `This link expires in ${h.expiresInHours ?? 24} hours. ` +
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
  const h = escapeFields(params);
  const subject = `${params.inviterName} invited you to ${params.accountName}`;
  const html = layout(
    heading(`You're invited to join ${h.accountName}`) +
      para(
        `<strong>${h.inviterName}</strong> has invited you to join <strong>${h.accountName}</strong> as a <strong>${h.roleLabel}</strong>.`,
      ) +
      button("Accept Invitation", h.inviteUrl) +
      smallNote(
        `This invitation expires in ${h.expiresInDays ?? 3} days. ` +
          `If you weren't expecting this, you can ignore this email.`,
      ),
    `${h.inviterName} invited you to ${h.accountName}`,
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
  const h = escapeFields(params);
  const graceDateStr = params.graceEndsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Action required: payment failed for ${params.accountName}`;
  const html = layout(
    heading("Your payment failed") +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `We were unable to process your payment of <strong>${h.amountFormatted}</strong> for ` +
          `<strong>${h.accountName}</strong>. Your account will remain active until <strong>${graceDateStr}</strong>, ` +
          `after which it will be suspended.`,
      ) +
      button("Update Payment Method", h.billingPortalUrl) +
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
  const h = escapeFields(params);
  const nextBillingStr = params.periodEnd.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Payment confirmed — ${params.accountName}`;
  const html = layout(
    heading("Payment confirmed") +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `Your payment of <strong>${h.amountFormatted}</strong> for <strong>${h.accountName}</strong> ` +
          `was processed successfully. Your next billing date is <strong>${nextBillingStr}</strong>.`,
      ) +
      button("View Invoice", h.invoiceUrl) +
      smallNote("Thank you for using " + APP_NAME + "."),
    `Your payment of ${h.amountFormatted} was successful`,
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
  const h = escapeFields(params);
  const accessEndStr = params.accessEndsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Your ${APP_NAME} subscription has been canceled`;
  const html = layout(
    heading("Subscription canceled") +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `Your subscription for <strong>${h.accountName}</strong> has been canceled. ` +
          `You'll continue to have access until <strong>${accessEndStr}</strong>.`,
      ) +
      para(
        "We'd love to have you back. You can resubscribe anytime before your access ends to keep your data and settings.",
      ) +
      button("Resubscribe", h.resubscribeUrl) +
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
  const h = escapeFields(params);
  const trialEndStr = params.trialEndsAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const subject = `Your ${APP_NAME} trial ends in ${params.daysLeft} day${params.daysLeft === 1 ? "" : "s"}`;
  const html = layout(
    heading(
      `Your trial ends ${h.daysLeft === 1 ? "tomorrow" : `in ${h.daysLeft} days`}`,
    ) +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `Your free trial for <strong>${h.accountName}</strong> ends on <strong>${trialEndStr}</strong>. ` +
          `Add a payment method now to keep full access without interruption.`,
      ) +
      button("Add Payment Method", h.upgradeUrl) +
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
  const h = escapeFields(params);
  const subject = `${params.newMemberName} joined ${params.accountName}`;
  const html = layout(
    heading(`New member joined ${h.accountName}`) +
      para(`Hi ${h.ownerFirstName || "there"},`) +
      para(
        `<strong>${h.newMemberName}</strong> (${h.newMemberEmail}) has accepted their invitation ` +
          `and joined <strong>${h.accountName}</strong> as a <strong>${h.roleLabel}</strong>.`,
      ) +
      button("View Team", h.membersUrl),
    `${h.newMemberName} joined your team`,
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
  const h = escapeFields(params);
  const subject = `Reset your ${APP_NAME} password`;
  const html = layout(
    heading("Reset your password") +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `We received a request to reset your password. Click the button below to choose a new one.`,
      ) +
      button("Reset Password", h.resetUrl) +
      smallNote(
        `This link expires in ${h.expiresInHours ?? 1} hour. ` +
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
 * Sent when someone registers an address that already has an unverified
 * account: the inbox owner finishes signing up by choosing a password.
 */
export function finishSignup(params: {
  firstName: string;
  url: string;
  expiresInHours?: number;
}): EmailContent {
  const h = escapeFields(params);
  const hours = params.expiresInHours ?? 24;
  const subject = `Finish creating your ${APP_NAME} account`;
  const html = layout(
    heading("Finish creating your account") +
      para(`Hi ${h.firstName || "there"},`) +
      para(
        `Someone (probably you) started creating a ${APP_NAME} account with this email address. Choose your password to finish, which also confirms this address is yours.`,
      ) +
      button("Choose password", h.url) +
      smallNote(
        `This link expires in ${hours} hours. If you didn't try to sign up, ignore this email: nobody can use the account without this link.`,
      ),
    "Finish creating your account",
  );
  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Someone (probably you) started creating a ${APP_NAME} account with this email address.\n` +
    `Choose your password to finish:\n${params.url}\n\n` +
    `This link expires in ${hours} hours. If you didn't try to sign up, ignore this email.\n\n` +
    `— ${APP_NAME}`;
  return { subject, html, text };
}

/**
 * Password reset success confirmation
 */
export function passwordResetSuccess(params: {
  firstName: string;
}): EmailContent {
  const h = escapeFields(params);
  const subject = `Your ${APP_NAME} password has been changed`;
  const html = layout(
    heading("Password changed successfully") +
      para(`Hi ${h.firstName || "there"},`) +
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

/**
 * New feedback received — sent to admin when a user submits anything
 */
export function feedbackReceived(params: {
  adminName?: string;
  userName: string;
  userEmail: string;
  type: string;
  title: string;
  description: string;
  feedbackId: string;
  adminPanelUrl: string;
}): EmailContent {
  const h = escapeFields(params);
  const typeLabel: Record<string, string> = {
    BUG_REPORT: "🐛 Bug Report",
    FEATURE_REQUEST: "💡 Feature Request",
    GENERAL_FEEDBACK: "💬 General Feedback",
    UI_ISSUE: "🎨 UI Issue",
  };

  const label = typeLabel[params.type] ?? params.type;

  const subject = `[${label}] ${params.title}`;

  const html = layout(
    heading(`New ${label} received`) +
      para(`Hi ${h.adminName || "there"},`) +
      para(
        `<strong>${h.userName}</strong> (${h.userEmail}) submitted a new ${label.toLowerCase()}.`,
      ) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="margin:20px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tr>
          <td style="padding:20px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">
              Title
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:#111827;font-weight:600;">
              ${h.title}
            </p>
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">
              Description
            </p>
            <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">
              ${h.description.slice(0, 500)}${h.description.length > 500 ? "..." : ""}
            </p>
          </td>
        </tr>
      </table>` +
      button("Review in Admin Panel", h.adminPanelUrl) +
      smallNote(
        `Feedback ID: ${h.feedbackId} · Submitted by ${h.userEmail}`,
      ),
    `New ${label} from ${h.userName}`,
  );

  const text =
    `New ${label} received\n\n` +
    `From: ${params.userName} (${params.userEmail})\n` +
    `Title: ${params.title}\n\n` +
    `Description:\n${params.description}\n\n` +
    `Review it here: ${params.adminPanelUrl}\n\n` +
    `Feedback ID: ${params.feedbackId}\n\n` +
    `— ${APP_NAME}`;

  return { subject, html, text };
}

/**
 * Alert notification (an alert rule fired, recovered or saw an event).
 */
export function alertNotification(params: {
  kind: "FIRING" | "RESOLVED" | "EVENT";
  title: string;
  message: string;
  accountName: string;
  ruleName: string;
  url: string;
}): EmailContent {
  const h = escapeFields(params);
  const tag = params.kind === "FIRING" ? "Alert" : params.kind === "RESOLVED" ? "Resolved" : "Notice";
  const subject = `[${tag}] ${params.title} — ${params.accountName}`;
  const color = params.kind === "FIRING" ? "#dc2626" : params.kind === "RESOLVED" ? "#16a34a" : "#2563eb";
  const html = layout(
    `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${color};">${tag}</p>` +
      heading(h.title) +
      para(h.message.replace(/\n/g, "<br>")) +
      button("Open the dashboard", params.url) +
      smallNote(`Sent by the alert rule “${h.ruleName}” of ${h.accountName}. Change or turn off alerts in the dashboard under Alerts.`),
    params.title,
  );
  const text = `${tag}: ${params.title}\n\n${params.message}\n\n${params.url}\n\nAlert rule: ${params.ruleName} (${params.accountName})\n— ${APP_NAME}`;
  return { subject, html, text };
}
