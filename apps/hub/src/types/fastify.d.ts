// fastify.d.ts or any file in your types folder

// import { JwtPayload } from 'jsonwebtoken'; // Adjust the import to match where JwtPayload is defined
// import { FastifyRequest } from 'fastify';

// declare module 'fastify' {
//   interface FastifyRequest {
//     user?: JwtPayload | null; // Add the 'user' property here
//   }
// }

// import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
// import { JwtPayload } from 'jsonwebtoken';

// declare module 'fastify' {
//   interface FastifyRequest {
//     user?: {
//       id: string;
//       roles: string[]; // User roles, if necessary
//       abilities: string[]; // List of abilities for the user
//     };
//   }
// }

// fastify.d.ts or your custom types file
import { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      roles: string[]; // An array of role names
      abilities: string[]; // An array of abilities
    };
  }
}
