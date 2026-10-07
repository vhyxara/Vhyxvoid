// Pure helpers for AiDraftDialog (tested in aiForm.test.ts).
import type { AiStatus } from '@/api/infrastructure/services/ai.service'

export type AiSourceChoice = 'description' | 'traffic' | 'spec'

/** Why "Draft" is disabled, or null. */
export function aiSourceProblem(v: { source: AiSourceChoice; description: string; label: string; specId: string; baseUrl: string }): string | null {
  if (v.description.length > 4000) return 'Keep the description under 4,000 characters'
  if (v.source === 'description' && v.description.trim().length < 10) return 'Describe the API in a sentence or two'
  if (v.source === 'traffic' && !v.label) return 'Pick a tunnel'
  if (v.source === 'spec' && !v.specId) return 'Pick API docs'
  if (v.baseUrl.trim() && !/^https?:\/\/[^\s/]+/i.test(v.baseUrl.trim())) return 'The base URL starts with http:// or https://'

  return null
}

export function aiUsageText(s: Pick<AiStatus, 'used' | 'limit' | 'resetsAt'>, now = new Date()): string {
  if (s.limit === null) return `${s.used} draft${s.used === 1 ? '' : 's'} this month.`
  const left = Math.max(0, s.limit - s.used)
  const days = Math.max(1, Math.ceil((new Date(s.resetsAt).getTime() - now.getTime()) / 86_400_000))

  return left ? `${left} of ${s.limit} drafts left this month.` : `You used all ${s.limit} drafts this month; more in ${days} day${days === 1 ? '' : 's'}.`
}
