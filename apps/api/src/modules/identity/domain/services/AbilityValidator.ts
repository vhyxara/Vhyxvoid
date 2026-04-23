/**
 * Utility to validate admin abilities without making DB calls
 * Can be used in middleware or use cases
 */
export class AbilityValidator {
  /**
   * Parse ability requirement string
   * Examples: "user:create", "role:*" (all role abilities)
   */
  static parseAbility(requirement: string): {
    category: string;
    action: string | '*';
  } {
    const [category, action] = requirement.split(':');
    return { category, action: action || '*' };
  }

  /**
   * Check if admin ability matches requirement
   */
  static matches(adminAbility: string, requirement: string): boolean {
    if (adminAbility === requirement) return true;

    // Support wildcards: "user:*" matches any user.* ability
    const [reqCategory, reqAction] = requirement.split(':');
    const [abilityCategory, abilityAction] = adminAbility.split('.');

    if (abilityCategory === reqCategory && reqAction === '*') {
      return true;
    }

    return false;
  }

  /**
   * Filter abilities by category
   */
  static filterByCategory(abilities: string[], category: string): string[] {
    return abilities.filter((a) => a.startsWith(`${category}.`));
  }

  /**
   * Get readable ability name
   */
  static getReadableName(ability: string): string {
    const nameMap: Record<string, string> = {
      'user.create': 'Create Users',
      'user.read': 'View Users',
      'user.update': 'Edit Users',
      'user.delete': 'Delete Users',
      'role.create': 'Create Roles',
      'role.read': 'View Roles',
      'role.update': 'Edit Roles',
      'role.delete': 'Delete Roles',
      'role.assign': 'Assign Roles',
      'ability.create': 'Create Abilities',
      'ability.read': 'View Abilities',
      'ability.update': 'Edit Abilities',
      'ability.delete': 'Delete Abilities',
      'admin.create': 'Create Admins',
      'admin.read': 'View Admins',
      'admin.update': 'Edit Admins',
      'admin.delete': 'Delete Admins',
      'admin.enable': 'Enable Admins',
      'admin.disable': 'Disable Admins',
      'audit.read': 'View Audit Logs',
      'audit.export': 'Export Audit Logs',
      'settings.read': 'View Settings',
      'settings.update': 'Update Settings',
    };

    return nameMap[ability] || ability;
  }
}
