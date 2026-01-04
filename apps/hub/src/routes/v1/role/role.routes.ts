// import { Router } from "express";
// import { authenticate } from "../middleware/auth";
// import { requireAbility } from "../middleware/ability";

import { createAbility, deleteAbility, listAbilities } from '@/controllers/role/ability.controller';
import {
  assignAbilitiesToRole,
  createRole,
  deleteRole,
  listRoles,
  updateRole,
} from '@/controllers/role/role.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { requireAbility } from '@/utils/auth';
import fastify, { FastifyInstance } from 'fastify';

export async function roleRouter(fastify: FastifyInstance) {
  // Authentication routes
  // Roles routes
  fastify.post(
    '/roles',
    // { preHandler: [authenticate, requireAbility('role.create')] },
    createRole,
  );

  fastify.get(
    '/roles',
    //  { preHandler: [authenticate, requireAbility('role.read')] },
    listRoles,
  );
  fastify.put(
    '/roles/:id',
    // { preHandler: [authenticate, requireAbility('role.update')] },
    updateRole,
  );
  fastify.delete(
    '/roles/:id',
    // { preHandler: [authenticate, requireAbility('role.delete')] },
    deleteRole,
  );

  fastify.post(
    '/roles/:roleId/abilities',
    // { preHandler: [authenticate, requireAbility('role.update')] },
    assignAbilitiesToRole,
  );

  // Abilities routes
  fastify.post(
    '/abilities',
    // { preHandler: [authenticate, requireAbility('ability.create')] },
    createAbility,
  );

  fastify.get(
    '/abilities',
    // { preHandler: [authenticate, requireAbility('ability.read')] },
    listAbilities,
  );

  fastify.delete(
    '/abilities/:id',
    // { preHandler: [authenticate, requireAbility('ability.delete')] },
    deleteAbility,
  );
}
