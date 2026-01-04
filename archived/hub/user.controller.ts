// import { successResponse } from '../../apps/hub/src/utils/response';
// import { UserService } from '@/db/services/user.service';
// import { FastifyReply, FastifyRequest } from 'fastify';

// export const UserController = {
//   async getAll(req: FastifyRequest, res: FastifyReply) {
//     const user = await UserService.getAll();
//     return successResponse(res, user, 'Users fetched successfully');
//   },
//   async getById(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
//     const user = await UserService.getById(req.params.id);
//     return successResponse(res, user, 'User fetched successfully');
//   },
//   async create(req: FastifyRequest<{ Body: { name?: string; email: string } }>, res: FastifyReply) {
//     const user = await UserService.create(req.body);
//     return successResponse(res, user, 'User created successfully', 201);
//   },
//   async update(
//     req: FastifyRequest<{ Params: { id: string }; Body: { name?: string; email?: string } }>,
//     res: FastifyReply,
//   ) {
//     const user = await UserService.update(req.params.id, req.body);
//     return successResponse(res, user, 'User updated successfully');
//   },
//   async delete(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
//     const user = await UserService.delete(req.params.id);
//     return successResponse(res, user, 'User deleted successfully');
//   },
// };
