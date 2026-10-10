import assert from 'node:assert/strict'
import test from 'node:test'
import JsBarcode from 'jsbarcode'
import { generateBarcodeSvg } from '../src/core/barcode.ts'

test('QR generator creates a local SVG for Unicode input and rejects empty input', async () => {
  const svg = await generateBarcodeSvg('实用工具箱 · QR 码', 'QR', 'M')
  assert.match(svg, /<svg\b/)
  assert.match(svg, /viewBox=/)
  await assert.rejects(generateBarcodeSvg('', 'QR', 'M'), /请输入要编码的内容/)
})

test('common linear barcode formats encode representative values', () => {
  const values = [
    ['CODE128', 'ABC 123'],
    ['CODE39', 'ABC123'],
    ['EAN13', '5901234123457'],
    ['EAN8', '96385074'],
    ['UPC', '036000291452'],
    ['ITF14', '10012345000017'],
  ]
  for (const [format, value] of values) {
    const result = {}
    JsBarcode(result, value, { format })
    assert.ok(result.encodings?.some(encoding => encoding.data.length > 0), `${format} should produce bars`)
  }
})
