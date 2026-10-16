import { Suspense } from 'react'

import { BlogPostsView } from '@/views/blog/BlogPostsView'

export default function Page() {
  return (
    <Suspense>
      <BlogPostsView />
    </Suspense>
  )
}
