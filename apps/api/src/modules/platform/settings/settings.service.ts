import {
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  SettingsReader,
  createPrismaSettingsReader,
  installSettingsReader,
  settingDefinition,
  validateSettingValue,
  type SettingKey,
  type SettingValue,
} from "@vhyxvoid/shared";
import type { PrismaClient } from "@/generated/prisma";
import { ValidationError } from "@/core/errors/error.format";

export type SettingView = {
  key: SettingKey;
  group: string;
  label: string;
  description: string;
  type: string;
  value: unknown;
  default: unknown;
  isDefault: boolean;
  public: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: readonly string[];
  updatedAt: string | null;
};

/**
 * Admin-editable runtime settings. Reads go through a cached SettingsReader
 * (also installed process-wide, so plan-limit resolution sees the same
 * values); writes validate against the registry in packages/shared.
 */
export class SettingsService {
  readonly reader: SettingsReader;

  constructor(private readonly prisma: PrismaClient) {
    this.reader = createPrismaSettingsReader(prisma);
    installSettingsReader(this.reader);
  }

  get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return this.reader.get(key);
  }

  publicValues() {
    return this.reader.publicValues();
  }

  async list(): Promise<{ groups: typeof SETTING_GROUPS; settings: SettingView[] }> {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const settings = (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
      const def = settingDefinition(key);
      const row = byKey.get(key);
      const checked = row ? validateSettingValue(key, row.value) : null;
      const value = checked?.ok ? checked.value : def.default;
      return {
        key,
        group: def.group,
        label: def.label,
        description: def.description,
        type: def.type,
        value,
        default: def.default,
        isDefault: !checked?.ok,
        public: def.public,
        min: def.min,
        max: def.max,
        maxLength: def.maxLength,
        options: def.options,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
    return { groups: SETTING_GROUPS, settings };
  }

  /**
   * Apply several changes at once (all validated first, then one
   * transaction). `null` resets a key to its default. Returns before/after
   * for the audit log.
   */
  async update(changes: Record<string, unknown>, adminId: string) {
    const errors: Array<{ path: string[]; message: string }> = [];
    const normalized: Array<{ key: SettingKey; value: unknown | null }> = [];
    for (const [key, raw] of Object.entries(changes)) {
      if (raw === null) {
        if (!(key in SETTING_DEFINITIONS)) errors.push({ path: [key], message: "Unknown setting" });
        else normalized.push({ key: key as SettingKey, value: null });
        continue;
      }
      const checked = validateSettingValue(key, raw);
      if (!checked.ok) errors.push({ path: [key], message: checked.error });
      else normalized.push({ key: key as SettingKey, value: checked.value });
    }
    if (errors.length) {
      throw new ValidationError(`Invalid settings: ${errors.map((e) => `${e.path[0]}: ${e.message}`).join("; ")}`);
    }
    if (normalized.length === 0) return { before: {}, after: {} };

    const before = await this.reader.all();
    await this.prisma.$transaction(
      normalized.map(({ key, value }) =>
        value === null
          ? this.prisma.systemSetting.deleteMany({ where: { key } })
          : this.prisma.systemSetting.upsert({
              where: { key },
              create: { key, value: value as object, updatedById: adminId },
              update: { value: value as object, updatedById: adminId },
            }),
      ),
    );
    this.reader.invalidate();
    const after = await this.reader.all();
    const pick = (o: Record<string, unknown>) => Object.fromEntries(normalized.map(({ key }) => [key, o[key]]));
    return { before: pick(before), after: pick(after) };
  }
}
