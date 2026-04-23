// identity/application/use-cases/LoginUser.ts

import { UnauthorizedError } from "@/core/errors/error.format";
import { Session } from "@/modules/identity/domain/entities/user/Session.entities";
import { PasswordHasher } from "@/modules/identity/domain/services/PasswordHasher";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
// import { RefreshToken } from "../../domain/entities/RefreshToken";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

// import { UserRepository } from "../../domain/repositories/UserRepository";
// import { SessionRepository } from "../../domain/repositories/SessionRepository";
// import { PasswordHasher } from "../../domain/services/PasswordHasher";
// import { JwtSigner } from "../../domain/services/JwtSigner";
// import { TokenGenerator } from "../../domain/services/TokenGenerator";
// import { Session } from "../../domain/entities/Session";
// import { Email } from "../../domain/value-objects/Email";
// import { randomUUID } from "crypto";

// interface Input {
//   email: string;
//   password: string;
// }

// export class LoginUser {
//   constructor(
//     private userRepo: UserRepository,
//     private sessionRepo: SessionRepository,
//     private hasher: PasswordHasher,
//     private jwtSigner: JwtSigner,
//     private tokenGenerator: TokenGenerator
//   ) {}

//   async execute(input: Input) {
//     const now = new Date();
//     const email = Email.create(input.email);

//     const user = await this.userRepo.findByEmail(email);
//     if (!user) {
//       throw new Error("Invalid credentials");
//     }

//     user.ensureCanLogin(now);

//     const valid = await this.hasher.compare(
//       input.password,
//       user.passwordHash!
//     );

//     if (!valid) {
//       user.recordFailedLoginAttempt(now);
//       await this.userRepo.save(user);
//       throw new Error("Invalid credentials");
//     }

//     user.recordSuccessfulLogin(now);
//     await this.userRepo.save(user);

//     const rawRefresh = this.tokenGenerator.generate();
//     const refreshHash = await this.tokenGenerator.hash(rawRefresh);

//     const session = Session.create({
//       id: randomUUID(),
//       userId: user.id,
//       refreshHash,
//       expiresAt: new Date(
//         now.getTime() + 7 * 24 * 60 * 60 * 1000
//       ),
//       now,
//     });

//     await this.sessionRepo.save(session);

//     const accessToken = await this.jwtSigner.signAccessToken({
//       sub: user.id,
//       sid: session.id,
//       type: "access",
//     });

//     return {
//       accessToken,
//       refreshToken: rawRefresh,
//     };
//   }
// }

export class LoginUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly jwtService: RS256JwtService,
    private readonly tokenGenerator: CryptoTokenGenerator,
    private readonly passwordHasher: PasswordHasher, // ✅ ADD THIS
    private readonly accessTokenTTL: number,
    private readonly refreshTokenTTL: number,
  ) {}

  async execute(
    email: string,
    password: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const now = new Date();

    // 1️⃣ Find user OUTSIDE transaction
    const user = await this.uow.userRepository.findByEmail(email);
    if (!user) throw new UnauthorizedError("Invalid credentials");

    user.ensureCanLogin(now);

    // 2️⃣ Verify password OUTSIDE transaction
    const isValid = await this.passwordHasher.compare(
      password,
      user.passwordHash,
    );

    if (!isValid) {
      // ✅ Save failure directly — no transaction, no rollback
      user.recordFailedLoginAttempt(now);
      await this.uow.userRepository.save(user);
      throw new UnauthorizedError("Invalid credentials");
    }

    // 3️⃣ Only wrap the SUCCESS path in a transaction
    return this.uow.execute(async ({ userRepository, sessionRepository }) => {
      user.resetLoginAttempts(now);
      await userRepository.save(user);

      const MAX_SESSIONS = 5;
      // Enforce session limit

      const activeSessions = await sessionRepository.countActiveByUserId(
        user.id,
        now,
      );

      if (activeSessions >= MAX_SESSIONS) {
        await sessionRepository.revokeOldestActiveSession(user.id, now);
      }

      const rawRefreshToken = this.tokenGenerator.generate(64);
      const tokenHash = TokenHasher.hash(rawRefreshToken);

      const session = Session.create({
        userId: user.id,
        tokenHash,
        ttlMs: this.refreshTokenTTL,
        ipAddress,
        userAgent,
      });

      await sessionRepository.save(session);

      const accessToken = this.jwtService.sign(
        { sub: user.id, email: user.email, tokenVersion: user.tokenVersion },
        { expiresIn: this.accessTokenTTL },
      );

      console.log("ACCESS TOKEN:", accessToken);
      console.log("DECODED:", this.jwtService.verify(accessToken));

      return {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn: this.accessTokenTTL,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      };
    });
  }
}

//   async execute(email: string, password: string) {
//       return this.uow.execute(async ({ userRepository, sessionRepository }) => {

//     // 1️⃣ Find user by email
//     const user = await userRepository.findByEmail(email);
//     if (!user) throw new UnauthorizedError("Invalid credentials");

//  const now = new Date();
//     // 1️⃣ Domain enforcement
//     user.ensureCanLogin(now);

//     // 3️⃣ Verify password
//     const isValid = await this.passwordHasher.compare(password, user.passwordHash);
//     if (!isValid) {
//       user.recordFailedLoginAttempt(now);
//       await userRepository.save(user);
//       throw new UnauthorizedError("Invalid credentials");
//     }

//         user.resetLoginAttempts(now);
//     await userRepository.save(user);

//     // 4️⃣ Generate refresh token
//     const rawRefreshToken = this.tokenGenerator.generate(64);
//     const tokenHash = TokenHasher.hash(rawRefreshToken);

//     const session = Session.create({
//       userId: user.id,
//       tokenHash,
//       ttlMs: this.refreshTokenTTL * 1000,
//     });

//     await sessionRepository.save(session);

//     // 5️⃣ Access token
//     const accessToken = this.jwtService.sign(
//       { sub: user.id, email: user.email },
//       { expiresIn: this.accessTokenTTL }
//     );

//     // 5️⃣ Generate refresh token
//     // const refreshToken = this.tokenGenerator.generate();
//     // const expiresAt = new Date(Date.now() + this.refreshTokenTTL * 1000);

//     // 6️⃣ Save refresh token in DB
//     // await this.uow.sessionRepository.save({
//     //   userId: user.id,
//     //   token: refreshToken,
//     //   expiresAt,
//     // });

//     return {
//       accessToken,
//       refreshToken : rawRefreshToken,
//       expiresIn: this.accessTokenTTL,
//       user: { id: user.id, email: user.email },
//     };
//         })
// }
