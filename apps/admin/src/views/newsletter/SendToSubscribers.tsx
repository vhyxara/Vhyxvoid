'use client'

// In the blog post editor (Publishing): email a live post to newsletter
// subscribers, once. "Send me a test" goes to your own address first.
import { useState } from 'react'

import { Button, Text, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { platformKeys, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { BlogPostDetail } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { formatDate } from '@/components/ui/format'

export function SendToSubscribers({ post, dirty }: { post: BlogPostDetail; dirty: boolean }) {
  const subscribers = useQuery({ queryKey: [...platformKeys.area('newsletter'), 'count'], queryFn: () => platformService.newsletter({ limit: 1 }) })
  const count: number = subscribers.data?.extra?.counts?.CONFIRMED ?? 0
  const send = usePlatformMutation(['blog', 'newsletter'], (test: boolean) => platformService.sendPostToNewsletter(post.id, test))
  const [confirm, setConfirm] = useState(false)
  const live = post.state === 'PUBLISHED'

  return (
    <div className='newsletter-send'>
      <Text size='sm' weight='semibold'>
        Email to subscribers
      </Text>
      {post.newsletterSentAt ? (
        <Text size='sm' tone='muted'>
          Emailed to subscribers {formatDate(post.newsletterSentAt)}. A post is sent once.
        </Text>
      ) : (
        <>
          <Text size='sm' tone='muted'>
            {live
              ? `Sends the title, excerpt and cover image, with a link to the post, to ${count === 1 ? '1 subscriber' : `${count} subscribers`}. A post can be sent once.`
              : 'Publish the post first: only live posts can be emailed.'}
          </Text>
          <div className='flex gap-2 flex-wrap'>
            <Button size='sm' variant='outline' disabled={dirty} loading={send.isPending && !confirm} onClick={() => send.mutateAsync(true).then((r: any) => toast.success(`Test sent to ${r.to}`)).catch((e: Error) => toast.danger(e.message))}>
              Send me a test
            </Button>
            <Button size='sm' disabled={!live || dirty || count === 0} onClick={() => setConfirm(true)}>
              Email {count === 1 ? '1 subscriber' : `${count} subscribers`}…
            </Button>
          </div>
          {dirty && (
            <Text size='xs' tone='muted'>
              Save your changes first.
            </Text>
          )}
        </>
      )}
      {confirm && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirm(false)}
          title={`Email “${post.title}” to ${count === 1 ? '1 subscriber' : `${count} subscribers`}?`}
          description='This can’t be undone, and the post can’t be sent again. Emails go out one by one over the next few minutes.'
          confirmLabel='Send'
          requireReason={false}
          onConfirm={() =>
            send
              .mutateAsync(false)
              .then((r: any) => (toast.success(`Sending to ${r.recipients} subscribers`), setConfirm(false)))
              .catch((e: Error) => toast.danger(e.message))
          }
        />
      )}
    </div>
  )
}
