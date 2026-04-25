import { describe, expect, test } from 'bun:test'
import {
  compileTrunkPatterns,
  findTrunkHits,
  loadTrunkPatterns,
  pathMatchesTrunk,
} from './trunkPatterns.js'

describe('trunk-patterns.json fixtures', () => {
  const file = loadTrunkPatterns()
  const regexes = compileTrunkPatterns(file.patterns)

  test('every must_match fixture matches at least one pattern', () => {
    for (const path of file.fixtures.must_match) {
      expect(pathMatchesTrunk(path, regexes)).toBe(true)
    }
  })

  test('every must_not_match fixture is not matched by any pattern', () => {
    for (const path of file.fixtures.must_not_match) {
      expect(pathMatchesTrunk(path, regexes)).toBe(false)
    }
  })

  test('findTrunkHits returns only the matched paths', () => {
    const inputs = [
      ...file.fixtures.must_match,
      ...file.fixtures.must_not_match,
    ]
    const hits = findTrunkHits(inputs, regexes)
    expect(new Set(hits)).toEqual(new Set(file.fixtures.must_match))
  })

  test('each pattern is a valid ECMAScript regex', () => {
    for (const p of file.patterns) {
      expect(() => new RegExp(p)).not.toThrow()
    }
  })

  test('patterns array is non-empty', () => {
    expect(file.patterns.length).toBeGreaterThan(0)
  })
})
