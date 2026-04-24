import { PlanLimits } from "@/modules/billing/domain/enums";

export interface PlanLimitService {
  getLimitsForAccount(accountId: string): Promise<PlanLimits>;
}
