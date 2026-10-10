import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const output = join(dirname(fileURLToPath(import.meta.url)), 'app.ico')
const sizes = [16, 32, 48, 256]

function lineDistance(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy)
}

function dib(size) {
  const scale = size / 32
  const segments = [
    { path: [15, 7, 12, 7], color: [142, 171, 255] }, { path: [12, 7, 10, 9], color: [142, 171, 255] },
    { path: [10, 9, 10, 14], color: [142, 171, 255] }, { path: [10, 14, 8, 16], color: [142, 171, 255] },
    { path: [8, 16, 10, 18], color: [142, 171, 255] }, { path: [10, 18, 10, 23], color: [142, 171, 255] },
    { path: [10, 23, 12, 25], color: [142, 171, 255] }, { path: [12, 25, 15, 25], color: [142, 171, 255] },
    { path: [17, 7, 20, 7], color: [117, 215, 188] }, { path: [20, 7, 22, 9], color: [117, 215, 188] },
    { path: [22, 9, 22, 14], color: [117, 215, 188] }, { path: [22, 14, 24, 16], color: [117, 215, 188] },
    { path: [24, 16, 22, 18], color: [117, 215, 188] }, { path: [22, 18, 22, 23], color: [117, 215, 188] },
    { path: [22, 23, 20, 25], color: [117, 215, 188] }, { path: [20, 25, 17, 25], color: [117, 215, 188] },
    { path: [19, 11, 13, 21], color: [178, 196, 255] },
  ]
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(size * size * 4, 20)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = [29, 37, 52]
      for (const segment of segments) {
        const path = segment.path.map(value => value * scale)
        if (lineDistance(x + .5, y + .5, path) < 1.15 * scale) color = segment.color
      }
      const at = ((size - 1 - y) * size + x) * 4
      pixels[at] = color[2]; pixels[at + 1] = color[1]; pixels[at + 2] = color[0]; pixels[at + 3] = 255
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size)
  return Buffer.concat([header, pixels, mask])
}

const images = sizes.map(dib)
const header = Buffer.alloc(6 + images.length * 16)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((image, index) => {
  const entry = 6 + index * 16
  header[entry] = sizes[index] === 256 ? 0 : sizes[index]
  header[entry + 1] = header[entry]
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
  offset += image.length
})
await mkdir(dirname(output), { recursive: true })
await writeFile(output, Buffer.concat([header, ...images]))
console.log(`Created ${output}`)
