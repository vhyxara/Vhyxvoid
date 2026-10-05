'use client'

import type { ReactNode } from 'react'

import { Alert } from '@vhyxui/react'

import { setting, usePublicBootstrap } from '@/api/application/hooks/usePublicSite'

/**
 * Admin-controlled notices for signed-in users: the announcement banner and,
 * while maintenance mode is on, a maintenance screen in place of the page
 * (the user API answers 503 during maintenance anyway).
 */
export function SiteNotices({ children }: { children: ReactNode }) {
  const { data } = usePublicBootstrap()
  const maintenance = setting(data, 'maintenance.enabled', false)
  const announce = setting(data, 'announcement.enabled', false) && setting(data, 'announcement.message', '')
  const tone = setting<'info' | 'success' | 'warning' | 'danger'>(data, 'announcement.tone', 'info')
  const link = setting(data, 'announcement.linkUrl', '')

  if (maintenance) {
    return (
      <div style={{ minBlockSize: '60vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxInlineSize: 520, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBlockEnd: 12 }}>We&apos;ll be right back</h1>
          <p style={{ color: 'var(--vhyx-color-text-muted)', lineHeight: 1.6 }}>
            {setting(data, 'maintenance.message', 'Scheduled maintenance is in progress.')}
          </p>
          <p style={{ color: 'var(--vhyx-color-text-muted)', marginBlockStart: 12, fontSize: '0.9rem' }}>
            Your running tunnels are not affected.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      {announce && (
        <div style={{ marginBlockEnd: 16 }}>
          <Alert variant={tone}>
            {announce}{' '}
            {link && (
              <a href={link} style={{ fontWeight: 600, textDecoration: 'underline' }}>
                {setting(data, 'announcement.linkText', '') || 'Learn more'}
              </a>
            )}
          </Alert>
        </div>
      )}
      {children}
    </>
  )
}
