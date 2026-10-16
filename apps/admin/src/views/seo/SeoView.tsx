'use client'

// The SEO screen: an audit of the whole site, the site-wide defaults, every
// address's title and description, redirects, and missing addresses. The tab
// (and the address being edited) live in the URL, so audit links open the
// right place and the back button works.
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Badge, Button, Skeleton, Tabs, Text } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { platformKeys, useSettings } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SeoAudit, SeoIssue } from '@/api/platform/types'
import { SeoDefaults } from './SeoDefaults'
import { SeoNotFound } from './SeoNotFound'
import { SeoPages } from './SeoPages'
import { SeoRedirects } from './SeoRedirects'
import { Panel, siteOrigin } from './previews'

const TABS = ['overview', 'defaults', 'pages', 'redirects', 'not-found'] as const
type Tab = (typeof TABS)[number]

const LEVEL: Record<SeoIssue['level'], { label: string; variant: 'danger' | 'warning' | 'info' }> = {
  error: { label: 'Fix now', variant: 'danger' },
  warning: { label: 'Should fix', variant: 'warning' },
  info: { label: 'Tip', variant: 'info' }
}

export const scoreTone = (score: number) => (score >= 90 ? 'good' : score >= 70 ? 'ok' : 'poor')

function Overview({ audit, go, origin }: { audit: SeoAudit; go: (tab: Tab, path?: string) => void; origin: string }) {
  const order = { error: 0, warning: 1, info: 2 }
  const issues = [...audit.issues].sort((a, b) => order[a.level] - order[b.level])

  return (
    <div className='flex flex-col gap-4'>
      <div className='seo-stats'>
        <div className='seo-score' data-tone={scoreTone(audit.score)}>
          <span className='seo-score-num'>{audit.score}</span>
          <span>SEO health</span>
        </div>
        <Panel>
            <Text size='sm' tone='muted'>
              Issues
            </Text>
            <Text size='lg' weight='medium'>
              {audit.counts.error} to fix now · {audit.counts.warning} to fix · {audit.counts.info} tips
            </Text>
          </Panel>
        <Panel>
            <Text size='sm' tone='muted'>
              Addresses
            </Text>
            <Text size='lg' weight='medium'>
              {audit.pages.live} live · {audit.pages.noindex} hidden · {audit.pages.withOverride} with overrides
            </Text>
          </Panel>
        <Panel>
            <Text size='sm' tone='muted'>
              Redirects
            </Text>
            <Text size='lg' weight='medium'>
              {audit.redirects}
            </Text>
          </Panel>
      </div>

      {issues.length === 0 ? (
        <Alert variant='success' title='Nothing to fix'>
          Every live address has a title and description of its own, and the site-wide settings are complete.
        </Alert>
      ) : (
        <Panel title='What to fix' description='Most important first. Fixing one updates the website straight away.'>
            <ul className='seo-audit-list'>
              {issues.slice(0, 200).map((i, n) => (
                <li key={`${i.code}-${i.path ?? ''}-${n}`}>
                  <Badge size='sm' variant={LEVEL[i.level].variant}>
                    {LEVEL[i.level].label}
                  </Badge>
                  <span className='seo-audit-msg'>
                    {i.path && i.fix === 'pages' && <code>{i.path}</code>} {i.message}
                  </span>
                  {i.fix && (
                    <Button size='xs' variant='outline' onClick={() => go(i.fix as Tab, i.fix === 'pages' ? i.path : undefined)}>
                      {i.fix === 'not-found' ? 'Redirect' : 'Fix'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {issues.length > 200 && (
              <Text size='sm' tone='muted'>
                …and {issues.length - 200} more. Filter the Pages tab by “Needs work”.
              </Text>
            )}
          </Panel>
      )}

      <Panel title='Check with outside tools' description='What search engines themselves make of the live site.'>
          <div className='flex gap-2 flex-wrap'>
            <Button size='sm' variant='outline' asChild>
              <a href={`https://search.google.com/test/rich-results?url=${encodeURIComponent(origin)}`} target='_blank' rel='noreferrer'>
                Rich results test ↗
              </a>
            </Button>
            <Button size='sm' variant='outline' asChild>
              <a href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(origin)}`} target='_blank' rel='noreferrer'>
                PageSpeed Insights ↗
              </a>
            </Button>
            <Button size='sm' variant='outline' asChild>
              <a href={`${origin}/sitemap.xml`} target='_blank' rel='noreferrer'>
                sitemap.xml ↗
              </a>
            </Button>
            <Button size='sm' variant='outline' asChild>
              <a href={`${origin}/robots.txt`} target='_blank' rel='noreferrer'>
                robots.txt ↗
              </a>
            </Button>
          </div>
        </Panel>
    </div>
  )
}

export function SeoView() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'overview'
  const focusPath = sp.get('path') ?? undefined
  const audit = useQuery({ queryKey: [...platformKeys.area('seo'), 'audit'], queryFn: platformService.seoAudit })
  const settings = useSettings()
  const origin = siteOrigin(settings.data?.settings.find(s => s.key === 'seo.siteUrl')?.value)

  const go = (next: Tab, path?: string) => {
    const q = new URLSearchParams()

    if (next !== 'overview') q.set('tab', next)
    if (path) q.set('path', path)
    router.push(`${pathname}${q.size ? `?${q}` : ''}`, { scroll: false })
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='SEO'
        description='How the website shows up in search results and link previews. Changes reach the website straight away; redirects within a minute.'
        actions={[
          <Button key='v' variant='ghost' asChild>
            <a href={origin} target='_blank' rel='noreferrer'>
              View site ↗
            </a>
          </Button>
        ]}
      />
      <Tabs value={tab} onValueChange={v => go(v as Tab)} variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='overview'>
            Overview{' '}
            {audit.data && (
              <Badge size='sm' variant={audit.data.counts.error ? 'danger' : audit.data.counts.warning ? 'warning' : 'success'}>
                {audit.data.score}
              </Badge>
            )}
          </Tabs.Trigger>
          <Tabs.Trigger value='defaults'>Site defaults</Tabs.Trigger>
          <Tabs.Trigger value='pages'>Pages</Tabs.Trigger>
          <Tabs.Trigger value='redirects'>Redirects</Tabs.Trigger>
          <Tabs.Trigger value='not-found'>Not found</Tabs.Trigger>
        </Tabs.List>
        <div className='mbs-4'>
          {tab === 'overview' && (audit.error ? <Alert variant='danger'>{(audit.error as Error).message}</Alert> : audit.data ? <Overview audit={audit.data} go={go} origin={origin} /> : <Skeleton height='20rem' />)}
          {tab === 'defaults' && <SeoDefaults />}
          {tab === 'pages' && <SeoPages key={focusPath ?? ''} focusPath={focusPath} />}
          {tab === 'redirects' && <SeoRedirects />}
          {tab === 'not-found' && <SeoNotFound />}
        </div>
      </Tabs>
      <Text size='xs' tone='muted'>
        Pages and blog posts also have their own SEO fields in <Link href='/content'>Website content</Link> and <Link href='/blog'>Blog</Link>; what you set here wins over them.
      </Text>
    </div>
  )
}
