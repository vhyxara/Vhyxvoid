import { describe, expect, it } from 'vitest'

import { unknownVariables } from './EmailsView'

describe('email wording', () => {
  it('flags variables the email does not have', () => {
    const vars = { firstName: 'Ada', url: 'https://x' }

    expect(unknownVariables({ subject: 'Hi {{firstName}}', body: 'Go: {{ url }}' }, vars)).toEqual([])
    expect(unknownVariables({ subject: 'Hi {{name}}', note: '{{name}} {{plan}}' }, vars)).toEqual(['name', 'plan'])
  })
})
