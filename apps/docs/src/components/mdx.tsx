import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'

// Plain <a> to a route owned by apps/web. next/link would prepend this app's
// basePath ('/docs') and point at a page that doesn't exist.
function Dash({ to, children }: { to: string; children: React.ReactNode }) {
  return <a href={to}>{children}</a>
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Dash,
    ...components
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
