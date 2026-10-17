'use client'

// Site-wide SEO: the "seo" settings, arranged by what they affect, with a
// live preview of the home page in search results and as a shared link.
import { useEffect, useState } from 'react'

import { Alert, Badge, Button, Skeleton, Text, toast } from '@vhyxui/react'
import { useQueryClient } from '@tanstack/react-query'

import { platformKeys, useSettings } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SettingView } from '@/api/platform/types'
import { ImageField } from '@/views/media/MediaPicker'
import { SettingInput } from '@/views/settings/SettingsView'
import { Panel, SerpPreview, SocialPreview, fullTitle, shareImage, siteOrigin } from './previews'

const SECTIONS: Array<{ title: string; description: string; keys: string[] }> = [
  { title: 'Titles and descriptions', description: 'What search results show for pages that say nothing more specific.', keys: ['seo.siteUrl', 'seo.titleTemplate', 'seo.defaultDescription'] },
  { title: 'Link previews', description: 'The card shown when someone shares a link in Slack, X, LinkedIn, WhatsApp…', keys: ['seo.defaultImage', 'seo.generatedImages', 'seo.twitterHandle'] },
  { title: 'Search engines', description: 'Whether and where crawlers may go, and proof to search consoles that the site is yours.', keys: ['seo.indexing', 'seo.robotsDisallow', 'seo.googleVerification', 'seo.bingVerification', 'seo.yandexVerification'] },
  { title: 'Organization', description: 'Who is behind the site, for search engines’ knowledge panels.', keys: ['seo.organizationLogo', 'seo.socialProfiles'] }
]

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function SeoDefaults() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useSettings()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => setDraft({}), [data])

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !data) return <Skeleton height='24rem' />

  const byKey = new Map(data.settings.map(s => [s.key, s]))
  const value = (k: string) => (k in draft ? draft[k] : byKey.get(k)?.value)
  const str = (k: string) => String(value(k) ?? '')
  const changed = Object.keys(draft).filter(k => !same(byKey.get(k)?.value, draft[k]))

  const save = async (changes: Record<string, unknown>) => {
    setSaving(true)
    setSaveError(null)
    try {
      qc.setQueryData(platformKeys.area('settings'), await platformService.updateSettings(changes))
      await qc.invalidateQueries({ queryKey: platformKeys.area('seo') })
      toast.success('Saved')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const origin = siteOrigin(value('seo.siteUrl'))
  const product = str('general.productName') || 'VhyxVoid'
  const homeTitle = `${product} — ${str('general.tagline')}`.replace(/ — $/, '')
  const sampleTitle = fullTitle('Pricing', str('seo.titleTemplate'), product)
  const description = str('seo.defaultDescription')
  const image = shareImage(origin, '', str('seo.defaultImage'), value('seo.generatedImages') !== false, 'Pricing')

  const field = (s: SettingView) => (
    <div key={s.key} className='seo-field'>
      <div>
        <Text weight='medium'>{s.label}</Text>
        <Text size='sm' tone='muted'>
          {s.description}
        </Text>
      </div>
      <div className='seo-field-input'>
        {s.key === 'seo.defaultImage' || s.key === 'seo.organizationLogo' ? (
          <div style={{ inlineSize: '100%' }}>
            <ImageField name={s.key} label={s.label} value={String(value(s.key) ?? '')} onChange={v => setDraft(d => ({ ...d, [s.key]: v }))} />
          </div>
        ) : (
          <SettingInput s={s} value={value(s.key)} onChange={v => setDraft(d => ({ ...d, [s.key]: v }))} />
        )}
        {!s.isDefault && !(s.key in draft) && (
          <Button size='xs' variant='link' onClick={() => save({ [s.key]: null })}>
            Reset to default
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <div className='seo-defaults' style={{ paddingBlockEnd: changed.length ? 80 : 0 }}>
      <div className='flex flex-col gap-4'>
        {value('seo.indexing') === false && (
          <Alert variant='danger' title='Search engines are kept out'>
            Every page says noindex and robots.txt disallows the whole site. Turn on “Let search engines index the site” when you launch.
          </Alert>
        )}
        {SECTIONS.map(section => (
          <Panel key={section.title} title={section.title} description={section.description}>
              <div className='flex flex-col gap-5'>{section.keys.map(k => byKey.get(k)).filter((s): s is SettingView => !!s).map(field)}</div>
            </Panel>
        ))}
        <Text size='sm' tone='muted'>
          Verification codes: in <a href='https://search.google.com/search-console' target='_blank' rel='noreferrer'>Google Search Console</a> or{' '}
          <a href='https://www.bing.com/webmasters' target='_blank' rel='noreferrer'>Bing Webmaster Tools</a>, add the site, choose the “HTML tag” method and paste the code from
          its <code>content=&quot;…&quot;</code>. Then submit <code>{origin}/sitemap.xml</code> there.
        </Text>
      </div>

      <aside className='seo-defaults-preview'>
        <Text weight='medium'>Home page in search results</Text>
        <SerpPreview url={`${origin}/`} title={homeTitle} description={description} />
        <Text weight='medium'>Another page (e.g. Pricing)</Text>
        <SerpPreview url={`${origin}/pricing`} title={sampleTitle} description={description} />
        <Text weight='medium'>Shared link, for a page with no image</Text>
        <SocialPreview url={origin} title={sampleTitle} description={description} image={image} />
        <Text size='xs' tone='muted'>
          Previews use what you have typed, before saving. Pages with their own title, description or image show those instead.{' '}
          {value('seo.indexing') === false ? <Badge variant='danger' size='sm'>noindex</Badge> : null}
        </Text>
      </aside>

      {changed.length > 0 && (
        <div className='seo-savebar'>
          <Text>
            {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
          </Text>
          {saveError && (
            <Text tone='danger' size='sm'>
              {saveError}
            </Text>
          )}
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button loading={saving} onClick={() => save(Object.fromEntries(changed.map(k => [k, draft[k]])))}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
