import { loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'

import { z } from 'zod'

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // Freshness contract (internal-tools/docs/context.md, Part 4B). Optional
    // here so stub pages validate; scripts/check-fresh.mjs is what enforces it
    // on pages that are not stubs.
    schema: pageSchema.extend({
      stub: z.boolean().optional(),
      verified: z
        .object({
          date: z.string(),
          commit: z.string(),
          packages: z.record(z.string(), z.string())
        })
        .optional(),
      sources: z.array(z.string()).optional()
    })
  },
  meta: { schema: metaSchema }
})

// baseUrl is '/' because next.config.mjs sets basePath '/docs'; Next's <Link>
// prepends it.
export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource()
})
