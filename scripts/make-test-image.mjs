#!/usr/bin/env node
// Generates public/test-image.png (640x360 gradient) with Node built-ins only, so the
// repo needs no image tooling dependency. Deterministic: same output every run.
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const W = 640
const H = 360
const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) {
  const row = y * (W * 3 + 1)
  raw[row] = 0 // filter type: none
  for (let x = 0; x < W; x++) {
    const i = row + 1 + x * 3
    raw[i] = Math.round((x / W) * 255)
    raw[i + 1] = Math.round((y / H) * 255)
    raw[i + 2] = (x >> 5) % 2 === (y >> 5) % 2 ? 200 : 60
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // truecolor RGB

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(new URL('../public/test-image.png', import.meta.url), png)
console.log(`wrote public/test-image.png (${png.length} bytes)`)
