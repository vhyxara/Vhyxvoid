/**
 * Tunnel labels become part of a hostname (`<slug>--<label>.<domain>`), so they
 * must be a valid DNS label: lowercase letters, digits and single hyphens,
 * 1-63 characters, not starting or ending with a hyphen. A double hyphen is
 * the slug/label separator and is not allowed inside a label.
 */
export const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Browsers lowercase hostnames, so labels are matched case-insensitively. */
export function normalizeLabel(label: unknown): string {
  return typeof label === "string" ? label.trim().toLowerCase() : "";
}

export function isValidLabel(label: unknown): label is string {
  return typeof label === "string" && LABEL_PATTERN.test(label) && !label.includes("--");
}

/** A human-readable reason a label was refused, or undefined when it is valid. */
export function labelProblem(label: unknown): string | undefined {
  if (typeof label !== "string" || label.length === 0) return "Label is required";
  if (label.length > 63) return "Label must be at most 63 characters";
  if (label.includes("--")) return 'Label must not contain "--"';
  if (!LABEL_PATTERN.test(label)) {
    return "Label may contain only lowercase letters, digits and hyphens, and must start and end with a letter or digit";
  }
  return undefined;
}
