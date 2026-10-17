// The accent colour from Settings › Brand, as CSS: the website's own accent
// variables (buttons, highlights) and VhyxUI's accent tokens (the dashboard).
// Shades are mixed from the one colour. Empty or malformed: nothing, and the
// built-in violet stays.
export function brandAccentCss(color: string | undefined | null): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return ''
  const c = color.toLowerCase()
  const mix = (other: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, ${other})`

  // !important: the brand and marketing token overrides are more specific; this one is the admin's choice.
  return [
    `:root{--brand-accent:${c};--brand-accent-deep:${mix('black', 85)};--brand-accent-mid:${mix('white', 82)};--brand-accent-light:${mix('white', 55)};--brand-glow:${mix('transparent', 80)}}`,
    `[data-brand]{--vhyx-color-accent:${c}!important;--vhyx-color-accent-hover:${mix('black', 85)}!important;--vhyx-color-accent-active:${mix('black', 78)}!important;--vhyx-color-accent-subtle:${mix('transparent', 12)}!important;--vhyx-color-accent-muted:${mix('transparent', 24)}!important}`
  ].join('')
}
