import { Typography } from '@/components/vhyxui-shims'

export default function SupportPage() {
  return (
    <main style={{ minHeight: '100vh', padding: '64px 32px' }}>
      <Typography variant='h1'>Support Page</Typography>
      {/* "[Support Email]" is a pre-existing literal placeholder in the
          original content, not something introduced by this migration —
          left as-is, fixing it is outside a component-migration pass. */}
      <Typography variant='body1' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
        For support, please contact us at [Support Email]
      </Typography>
    </main>
  )
}
