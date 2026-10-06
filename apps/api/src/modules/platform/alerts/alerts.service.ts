// Sends alert notifications and records them (AlertEvent). Used by the alert
// worker (state rules) and by anything that has an event to report
// (domain checks, inbox failures): emitEvent().
//
// Channels per rule: in-app + email to the account's owners and admins
// (notifyMembers), extra email addresses, one webhook URL. At most
// ALERT_MAX_NOTIFICATIONS_PER_HOUR are delivered per rule; the rest are
// recorded as suppressed, so a flapping tunnel cannot flood anyone.
import type { PrismaClient } from "@/generated/prisma";
import { NotificationType } from "@/modules/notification/domain/enums";
import type { NotificationService } from "@/modules/notification/application/use-cases";
import { ALERT_MAX_NOTIFICATIONS_PER_HOUR, describeAlertRule, type AlertRuleLike, type AlertTypeName } from "@vhyxvoid/shared";
import { RoleLevel } from "@/core/constant/account.constant";
import { postAlertWebhook } from "./webhook";

export type AlertKind = "FIRING" | "RESOLVED" | "EVENT";

export interface AlertMessage {
  kind: AlertKind;
  subject: string;
  title: string;
  message: string;
  /** Dashboard path, e.g. /organizations/<id>/tunnels */
  path: string;
}

export interface AlertRuleRow extends AlertRuleLike {
  id: string;
  accountId: string;
  name: string;
  notifyMembers: boolean;
  emails: string[];
  webhookUrl: string | null;
}

const appUrl = () => (process.env.APP_URL ?? "https://www.vhyxvoid.com").replace(/\/$/, "");

export class AlertService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: () => NotificationService | undefined,
  ) {}

  /** Notify every enabled rule of `type` for this account (event rules: DOMAIN, INBOX_FAILED). */
  async emitEvent(accountId: string, type: AlertTypeName, msg: Omit<AlertMessage, "kind">, label?: string): Promise<number> {
    const rules = await this.prisma.alertRule.findMany({ where: { accountId, type, enabled: true } });
    let sent = 0;
    for (const rule of rules) {
      if (rule.label && label && rule.label !== label) continue;
      await this.notify(rule as AlertRuleRow, { ...msg, kind: "EVENT" });
      sent++;
    }
    return sent;
  }

  /** Delivers one notification of a rule on all its channels and records it. */
  async notify(rule: AlertRuleRow, msg: AlertMessage): Promise<{ suppressed: boolean }> {
    const recent = await this.prisma.alertEvent.count({
      where: { ruleId: rule.id, createdAt: { gte: new Date(Date.now() - 3_600_000) }, NOT: { deliveries: { path: ["suppressed"], equals: true } } },
    });
    const url = `${appUrl()}${msg.path}`;
    if (recent >= ALERT_MAX_NOTIFICATIONS_PER_HOUR) {
      await this.record(rule, msg, { suppressed: true });
      return { suppressed: true };
    }

    const account = await this.prisma.account.findUnique({ where: { id: rule.accountId }, select: { name: true } });
    const accountName = account?.name ?? "your workspace";
    const deliveries: Record<string, unknown> = {};
    const svc = this.notifications();

    // Owners and admins: in-app, and email.
    const members = rule.notifyMembers
      ? await this.prisma.accountMember.findMany({
          where: { accountId: rule.accountId, roleLevel: { gte: RoleLevel.ADMIN }, user: { deletedAt: null } },
          select: { user: { select: { id: true, email: true } } },
        })
      : [];
    if (svc && members.length) {
      const type = rule.type === "TUNNEL_OFFLINE" ? NotificationType.TUNNEL_DISCONNECTED : NotificationType.SYSTEM_ALERT;
      const results = await Promise.allSettled(
        members.map((m) =>
          svc.createInApp.execute({
            userId: m.user.id,
            accountId: rule.accountId,
            type,
            title: msg.title,
            body: msg.message,
            actionUrl: msg.path,
            metadata: { alertRuleId: rule.id, kind: msg.kind, subject: msg.subject },
          }),
        ),
      );
      deliveries.inApp = results.filter((r) => r.status === "fulfilled").length;
    }

    const emails = [...new Set([...members.map((m) => m.user.email), ...rule.emails].map((e) => e.toLowerCase()))];
    if (svc && emails.length) {
      const results = await Promise.allSettled(
        emails.map((to) => svc.sendAlert.execute({ to, kind: msg.kind, title: msg.title, message: msg.message, accountName, ruleName: rule.name, url })),
      );
      deliveries.email = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - (deliveries.email as number);
      if (failed) deliveries.emailFailed = failed;
    }

    if (rule.webhookUrl) {
      const emoji = msg.kind === "FIRING" ? "🔴" : msg.kind === "RESOLVED" ? "✅" : "🔔";
      const text = `${emoji} ${msg.title}\n${msg.message}\n${url}`;
      deliveries.webhook = await postAlertWebhook(rule.webhookUrl, {
        text, // Slack
        content: text, // Discord
        alert: {
          rule: { id: rule.id, name: rule.name, type: rule.type, description: describeAlertRule(rule) },
          kind: msg.kind,
          subject: msg.subject,
          title: msg.title,
          message: msg.message,
          url,
          accountId: rule.accountId,
          at: new Date().toISOString(),
        },
      });
    }

    await this.record(rule, msg, deliveries);
    return { suppressed: false };
  }

  private async record(rule: AlertRuleRow, msg: AlertMessage, deliveries: Record<string, unknown>) {
    await this.prisma.alertEvent.create({
      data: {
        ruleId: rule.id,
        accountId: rule.accountId,
        subject: msg.subject,
        kind: msg.kind,
        title: msg.title.slice(0, 300),
        message: msg.message.slice(0, 2000),
        deliveries: deliveries as object,
      },
    });
  }
}
