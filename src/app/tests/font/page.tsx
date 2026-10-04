import { Inter } from 'next/font/google'

// next/font/google downloads the font at BUILD time and serves it from this app's own origin,
// so visitors never contact Google (privacy) and font-src 'self' stays strict.
const inter = Inter({ subsets: ['latin'], display: 'swap' })

export default function FontPage() {
  return (
    <section data-testid="result" data-feature="font">
      <h1>font</h1>
      <p>
        render mode: <strong data-testid="render-mode">static + next/font</strong>
      </p>
      <p className={inter.className} data-testid="font-sample">
        The quick brown fox jumps over the lazy dog.
      </p>
    </section>
  )
}
