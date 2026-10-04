import Image from 'next/image'

// Optimizes a LOCAL image through /_next/image. remotePatterns is empty in next.config.ts,
// so the optimizer refuses every remote URL.
export default function ImagePage() {
  return (
    <section data-testid="result" data-feature="image">
      <h1>image</h1>
      <p>
        render mode: <strong data-testid="render-mode">static + next/image</strong>
      </p>
      <Image src="/test-image.png" alt="Generated gradient test image" width={640} height={360} />
    </section>
  )
}
