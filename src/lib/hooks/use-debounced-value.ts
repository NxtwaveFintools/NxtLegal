import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after the caller
 * stops changing `value` for `delayMs` milliseconds.
 *
 * Usage:
 * ```ts
 * const [search, setSearch] = useState('')
 * const debouncedSearch = useDebouncedValue(search, 400)
 * // debouncedSearch updates 400 ms after the last keystroke
 * ```
 *
 * @param value  The rapidly-changing source value (e.g. text input state).
 * @param delayMs  Debounce window in milliseconds. Defaults to 400.
 * @returns The debounced value.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}
