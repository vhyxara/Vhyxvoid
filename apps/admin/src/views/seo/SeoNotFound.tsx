'use client'

// Addresses visitors asked for that don't exist, reported by the website.
// Most-asked first: an old link still out there is worth a redirect.
import { useEffect, useState } from 'react'

import { Alert, Button, Text, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SeoNotFoundRow } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate } from '@/components/ui/format'
import { SEO_AREAS } from './previews'
import { RedirectDialog, useDebounced } from './SeoRedirects'

export function SeoNotFound() {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput)
  const query = usePlatformList('seo-not-found', platformService.seoNotFound, { page, limit: 25, ...(search ? { search } : {}) })
  const [redirecting, setRedirecting] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const dismiss = usePlatformMutation(SEO_AREAS, (id: string) => platformService.dismissSeoNotFound(id))
  const clear = usePlatformMutation(SEO_AREAS, () => platformService.clearSeoNotFound())

  useEffect(() => setPage(1), [search])

  return (
    <div className='flex flex-col gap-3'>
      <Alert variant='info'>
        The website reports every address that answered “not found”. Redirect the ones with real visitors (old links, typos in shared URLs) to the right page; dismiss bots probing for
        things like <code>/wp-admin</code>. Reporting needs the website refresh to be set up (<code>WEB_REVALIDATE_SECRET</code>).
      </Alert>
      <ServerTable<SeoNotFoundRow>
        query={query}
        page={page}
        onPageChange={setPage}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Address' }}
        toolbar={
          <Button size='sm' variant='outline' disabled={!query.data?.items.length} onClick={() => setClearing(true)}>
            Clear all
          </Button>
        }
        emptyTitle='Nothing missing'
        emptyDescription='No visitor has hit a missing address yet.'
        columns={[
          { key: 'path', header: 'Address', cell: r => <code style={{ overflowWrap: 'anywhere' }}>{r.path}</code> },
          { key: 'hits', header: 'Times asked', cell: r => r.hits.toLocaleString() },
          { key: 'lastAt', header: 'Last', cell: r => formatDate(r.lastAt) },
          {
            key: 'referrer',
            header: 'Linked from',
            cell: r =>
              r.referrer ? (
                <Text size='xs' style={{ overflowWrap: 'anywhere' }}>
                  {r.referrer}
                </Text>
              ) : (
                <Text tone='muted'>—</Text>
              )
          },
          {
            key: 'actions',
            header: '',
            cell: r => (
              <div className='flex gap-1 justify-end'>
                <Button size='sm' variant='outline' onClick={() => setRedirecting(r.path)}>
                  Redirect…
                </Button>
                <Button size='sm' variant='ghost' onClick={() => dismiss.mutateAsync(r.id).catch((e: Error) => toast.danger(e.message))}>
                  Dismiss
                </Button>
              </div>
            )
          }
        ]}
      />
      {redirecting && <RedirectDialog row={null} initialFrom={redirecting} onClose={() => setRedirecting(null)} />}
      <ReasonDialog
        open={clearing}
        onOpenChange={setClearing}
        title='Clear the list of missing addresses?'
        description='It fills up again as visitors hit missing addresses.'
        confirmLabel='Clear'
        requireReason={false}
        onConfirm={() => clear.mutateAsync(undefined).then(() => toast.success('Cleared'))}
      />
    </div>
  )
}
