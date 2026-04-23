import { FastifyInstance } from "fastify";
// import { registerIdentityUseCases } from './usecases/registerUseCases';
import { registerAdminUseCases } from "./usecases/registerAdmin.presentation.usecase";
import { registerAccountUseCases } from "./usecases/registerAccount.presentation.usecase";
import { registerIdentityUseCases } from "./usecases/registerIdentity.presentation.usecase";
import { registerBillingUseCases } from "@/modules/billing/presentation/plugins/usecases/registerBillingUseCases";
import { registerNotificationUseCases } from "@/modules/notification/presentation/plugins/registerNotificationUseCases";

export async function registerModules(fastify: FastifyInstance) {
  const container = fastify.container;
  registerNotificationUseCases(container);

  registerIdentityUseCases(container);
  registerAdminUseCases(container);
  registerAccountUseCases(container);
}
