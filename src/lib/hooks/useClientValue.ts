'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * Reads a browser-only value (localStorage, window.location, ...) without a
 * hydration mismatch: the server snapshot is used for the first render, and
 * React reconciles to the real client value right after mount — no manual
 * setState-in-an-effect needed.
 */
export function useClientValue<T>(getValue: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, getValue, () => serverValue);
}
