'use client'

// "Preview": opens the saved draft of a page or a post on the website, with
// the real layout, through a signed link that works for 48 hours (shareable).
// With unsaved changes it saves first, so the preview shows what was just written.
import { useState } from 'react'

import { Button, toast } from '@vhyxui/react'

import { platformService } from '@/api/platform/service'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')

export function PreviewButton({ kind, id, dirty, save }: { kind: 'content' | 'post'; id: string; dirty: boolean; save: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)

  const open = async () => {
    // Opened now, in the click, so a popup blocker lets it through; filled in when the link is ready.
    const tab = window.open('about:blank', '_blank')

    setBusy(true)

    try {
      if (dirty) await save()
      const { token } = await platformService.previewLink(kind, id)
      const url = `${SITE}/preview/${token}`

      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch (e) {
      tab?.close()
      toast.danger((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant='outline' loading={busy} onClick={open} title='Opens the saved draft on the website. The link works for 48 hours and can be shared.'>
      {dirty ? 'Save & preview ↗' : 'Preview ↗'}
    </Button>
  )
}
