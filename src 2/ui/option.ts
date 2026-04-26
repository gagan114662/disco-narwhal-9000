/**
 * Stub for #68 burndown — Option type for the ink UI primitives.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Option<T = any> = {
  label: string
  value: T
  description?: string
  disabled?: boolean
} & Record<string, any>
