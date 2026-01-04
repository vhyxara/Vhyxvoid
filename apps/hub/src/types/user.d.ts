// User Interface
interface User {
  id: string;
  email: string;
  username: string;
  password: string;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
  firstName: string;
  lastName: string;
  deactivatedAt: Date | null;
  isEmailVerified: boolean;
  roles: UserRole[];
}

// Role Interface
interface Role {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  status: boolean;
  users: UserRole[];
  abilities: RoleAbility[];
}

// Ability Interface
interface Ability {
  id: string;
  action: string;
  description: string | null;
}

// UserRole Interface (join table between User and Role)
interface UserRole {
  userId: string;
  roleId: string;
  user: User;
  role: Role;
}

// RoleAbility Interface (join table between Role and Ability)
interface RoleAbility {
  roleId: string;
  abilityId: string;
  role: Role;
  ability: Ability;
}
