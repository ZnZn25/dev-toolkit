import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUuid, generateUuidBatch } from '../src/core/uuid.ts'

const sample = '550e8400-e29b-41d4-a716-446655440000'

test('UUID formats preserve the canonical UUID while changing only its representation', () => {
  assert.equal(formatUuid(sample, 'standard'), sample)
  assert.equal(formatUuid(sample, 'uppercase'), sample.toUpperCase())
  assert.equal(formatUuid(sample, 'compact'), '550e8400e29b41d4a716446655440000')
  assert.equal(formatUuid(sample, 'urn'), `urn:uuid:${sample}`)
  assert.equal(formatUuid(sample, 'braces'), `{${sample}}`)
})

test('UUID batches use local random UUID v4 values and validate count bounds', () => {
  const values = generateUuidBatch(30, 'standard')
  assert.equal(values.length, 30)
  assert.ok(values.every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)))
  assert.throws(() => generateUuidBatch(0, 'standard'), RangeError)
  assert.throws(() => generateUuidBatch(10_001, 'standard'), RangeError)
  assert.throws(() => generateUuidBatch(1.5, 'standard'), RangeError)
})
