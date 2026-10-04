import type { TestResult } from '@/lib/result'

// Renders a result with stable data-testid hooks for the runner. Text only; no raw HTML.
export function ResultBlock({ result }: { result: TestResult }) {
  return (
    <section data-testid="result" data-feature={result.feature}>
      <h1>{result.feature}</h1>
      <p>
        render mode: <strong data-testid="render-mode">{result.renderMode}</strong>
      </p>
      <p>
        timestamp: <time data-testid="timestamp">{result.timestamp}</time>
      </p>
      <ul>
        {Object.entries(result.details).map(([key, value]) => (
          <li key={key}>
            {key}: <span data-testid={`detail-${key}`}>{String(value)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
