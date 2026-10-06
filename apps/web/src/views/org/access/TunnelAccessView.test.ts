import { describe, expect, it } from 'vitest'

import { parseAllowlistInput } from './TunnelAccessView'

describe('parseAllowlistInput', () => {
  it('splits on lines, commas and spaces', () => {
    expect(parseAllowlistInput('1.2.3.4\n10.0.0.0/8, ::1  \n\n')).toEqual(['1.2.3.4', '10.0.0.0/8', '::1'])
    expect(parseAllowlistInput('   ')).toEqual([])
  })
})
