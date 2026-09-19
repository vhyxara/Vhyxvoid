import type { Metadata } from 'next'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'

import { Provider } from '@/components/provider'
import { baseOptions } from '@/lib/layout.shared'
import { source } from '@/lib/source'

import './global.css'

export const metadata: Metadata = {
  title: { default: 'VhyxVoid Docs', template: '%s — VhyxVoid Docs' },
  description: 'Documentation for VhyxVoid: expose your local server through a stable public URL.'
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang='en' data-brand='vhyxvoid' data-theme='dark' suppressHydrationWarning>
      <body className='flex min-h-screen flex-col'>
        <Provider>
          <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  )
}
