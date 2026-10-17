// Emails whose words an admin can change (admin panel › Emails). Each has
// default wording (what the code sends today), the {{variables}} it can use,
// and sample values for the preview. Overrides are stored in the setting
// `emails.overrides` as { [key]: { subject?, heading?, body?, button?, note? } };
// an empty field falls back to the default. The API renders them in the
// standard email layout (notification/infrastructure/email/templates).

export type EmailFields = { subject: string; heading: string; body: string; button: string; note: string };
export type EmailOverrides = Partial<Record<EditableEmailKey, Partial<EmailFields>>>;

type Def = {
  label: string;
  description: string;
  /** Variables the text can use, with a sample value for the preview. `url` is the button's link. */
  variables: Record<string, string>;
  defaults: EmailFields;
};

const COMMON = { productName: "VhyxVoid", supportEmail: "support@vhyxvoid.com" };

export const EDITABLE_EMAILS = {
  emailVerification: {
    label: "Verify email address",
    description: "Sent after someone signs up, with the link that confirms their address.",
    variables: { ...COMMON, firstName: "Ada", url: "https://www.vhyxvoid.com/verify-email?token=…", hours: "24" },
    defaults: {
      subject: "Verify your email — {{productName}}",
      heading: "Verify your email address",
      body: "Hi {{firstName}},\n\nYou're almost set! Click the button below to verify your email address and activate your {{productName}} account.",
      button: "Verify Email Address",
      note: "This link expires in {{hours}} hours. If you didn't create an account, you can safely ignore this email.",
    },
  },
  finishSignup: {
    label: "Finish signing up",
    description: "Sent when someone signs up again with an address that was never verified.",
    variables: { ...COMMON, firstName: "Ada", url: "https://www.vhyxvoid.com/reset-password?token=…", hours: "24" },
    defaults: {
      subject: "Finish creating your {{productName}} account",
      heading: "Finish creating your account",
      body: "Hi {{firstName}},\n\nSomeone (probably you) started creating a {{productName}} account with this email address. Choose your password to finish, which also confirms this address is yours.",
      button: "Choose password",
      note: "This link expires in {{hours}} hours. If you didn't try to sign up, ignore this email: nobody can use the account without this link.",
    },
  },
  passwordResetRequest: {
    label: "Reset password",
    description: "Sent when someone asks to reset a forgotten password.",
    variables: { ...COMMON, firstName: "Ada", url: "https://www.vhyxvoid.com/reset-password?token=…", hours: "1" },
    defaults: {
      subject: "Reset your {{productName}} password",
      heading: "Reset your password",
      body: "Hi {{firstName}},\n\nWe received a request to reset your password. Click the button below to choose a new one.",
      button: "Reset Password",
      note: "This link expires in {{hours}} hour. If you didn't request a password reset, you can safely ignore this email — your password won't change.",
    },
  },
  passwordResetSuccess: {
    label: "Password changed",
    description: "Sent after a password is changed, as a security notice.",
    variables: { ...COMMON, firstName: "Ada", url: "mailto:support@vhyxvoid.com" },
    defaults: {
      subject: "Your {{productName}} password has been changed",
      heading: "Password changed successfully",
      body: "Hi {{firstName}},\n\nYour password has been changed successfully. You've been logged out of all devices for security.\n\nIf you did not make this change, please contact support immediately.",
      button: "Contact Support",
      note: "This is an automated security notification from {{productName}}.",
    },
  },
  accountInvitation: {
    label: "Team invitation",
    description: "Sent to someone invited to join an organization.",
    variables: { ...COMMON, inviterName: "Grace Hopper", accountName: "Acme", role: "Member", url: "https://www.vhyxvoid.com/invitations/accept?token=…", days: "3" },
    defaults: {
      subject: "{{inviterName}} invited you to {{accountName}}",
      heading: "You're invited to join {{accountName}}",
      body: "**{{inviterName}}** has invited you to join **{{accountName}}** as a **{{role}}**.",
      button: "Accept Invitation",
      note: "This invitation expires in {{days}} days. If you weren't expecting this, you can ignore this email.",
    },
  },
  trialEnding: {
    label: "Trial ending",
    description: "Sent to owners and admins a few days before a trial ends.",
    variables: { ...COMMON, firstName: "Ada", accountName: "Acme", trialEnds: "October 31, 2026", daysLeft: "3", url: "https://www.vhyxvoid.com/organizations/…/billing" },
    defaults: {
      subject: "Your {{productName}} trial ends in {{daysLeft}} days",
      heading: "Your trial ends in {{daysLeft}} days",
      body: "Hi {{firstName}},\n\nYour free trial for **{{accountName}}** ends on **{{trialEnds}}**. Add a payment method now to keep full access without interruption.",
      button: "Add Payment Method",
      note: "No action needed if you choose not to continue — your account will be automatically downgraded to the free plan.",
    },
  },
  paymentFailed: {
    label: "Payment failed",
    description: "Sent when a subscription payment fails and the grace period starts.",
    variables: { ...COMMON, firstName: "Ada", accountName: "Acme", amount: "$12.00", graceEnds: "October 24, 2026", url: "https://billing.stripe.com/…" },
    defaults: {
      subject: "Action required: payment failed for {{accountName}}",
      heading: "Your payment failed",
      body: "Hi {{firstName}},\n\nWe were unable to process your payment of **{{amount}}** for **{{accountName}}**. Your account will remain active until **{{graceEnds}}**, after which it will be suspended.",
      button: "Update Payment Method",
      note: "If you have already updated your payment method, please allow a few minutes for the payment to process.",
    },
  },
  newsletterConfirm: {
    label: "Newsletter: confirm subscription",
    description: "Sent after someone signs up for the newsletter on the website (double opt-in).",
    variables: { ...COMMON, url: "https://www.vhyxvoid.com/newsletter/confirm?token=…" },
    defaults: {
      subject: "Confirm your subscription to {{productName}} updates",
      heading: "One click to confirm",
      body: "Someone (hopefully you) asked to get {{productName}} product updates and new blog posts at this address.",
      button: "Yes, subscribe me",
      note: "If it wasn't you, ignore this email: you won't hear from us again. The link works for 7 days.",
    },
  },
} satisfies Record<string, Def>;

export type EditableEmailKey = keyof typeof EDITABLE_EMAILS;

export const EMAIL_FIELD_LIMITS: Record<keyof EmailFields, number> = { subject: 160, heading: 160, body: 3000, button: 40, note: 600 };

export const isEditableEmail = (key: string): key is EditableEmailKey => key in EDITABLE_EMAILS;

/** {{name}} placeholders in a text. */
export const placeholdersOf = (text: string) => [...text.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map((m) => m[1]);

/** Problems with one email's fields: too long, or a {{variable}} it doesn't have. */
export function emailFieldProblems(key: EditableEmailKey, fields: Partial<EmailFields>): string[] {
  const vars = Object.keys(EDITABLE_EMAILS[key].variables);
  const out: string[] = [];
  for (const [f, v] of Object.entries(fields) as Array<[keyof EmailFields, unknown]>) {
    if (!(f in EMAIL_FIELD_LIMITS)) out.push(`Unknown field "${f}"`);
    else if (typeof v !== "string") out.push(`${f}: must be text`);
    else {
      if (v.length > EMAIL_FIELD_LIMITS[f]) out.push(`${f}: at most ${EMAIL_FIELD_LIMITS[f]} characters`);
      for (const p of placeholdersOf(v)) if (!vars.includes(p)) out.push(`${f}: {{${p}}} isn't available in this email (use ${vars.map((x) => `{{${x}}}`).join(", ")})`);
    }
  }
  return out;
}

/** The `emails.overrides` setting: known emails and fields, valid placeholders. */
export function validateEmailOverrides(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Must be an object of emails";
  for (const [key, fields] of Object.entries(value as Record<string, unknown>)) {
    if (!isEditableEmail(key)) return `Unknown email "${key}"`;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return `${key}: must be an object of fields`;
    const problems = emailFieldProblems(key, fields as Partial<EmailFields>);
    if (problems.length) return `${key}: ${problems[0]}`;
  }
  return undefined;
}

/** {{name}} → the value (through `escape` for HTML); unknown names are left empty. */
export function fillPlaceholders(text: string, vars: Record<string, string>, escape: (s: string) => string = (s) => s): string {
  return text.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_m, name: string) => escape(vars[name] ?? ""));
}

/** The fields an email is sent with: the override where set, the default elsewhere. */
export function emailFields(key: EditableEmailKey, overrides: EmailOverrides | null | undefined): EmailFields {
  const d = EDITABLE_EMAILS[key].defaults;
  const o = overrides?.[key] ?? {};
  return {
    subject: o.subject?.trim() || d.subject,
    heading: o.heading?.trim() || d.heading,
    body: o.body?.trim() || d.body,
    button: o.button?.trim() || d.button,
    note: o.note?.trim() || d.note,
  };
}
