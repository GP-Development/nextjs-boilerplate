import { skipped } from './lib.ts'
import type { TestDef } from './lib.ts'

// Filled in by the Cache Components variant (commit 9).
export const cacheComponentTests: TestDef[] = [
  {
    id: 'cache-components',
    feature: '8',
    name: 'Cache Components / "use cache" / PPR',
    async run({ variant }) {
      return skipped(`placeholder (variant: ${variant})`)
    },
  },
]
