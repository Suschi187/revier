// Kleine Assertions ohne weitere Abhängigkeit (node:assert zieht beim Typcheck @types/node nach).

export function ok(value: unknown, message = "erwartet: wahr"): asserts value {
  if (!value) throw new Error(message);
}

export function strictEqual<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message ?? "ungleich"}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

/** Für einfache Objekte und Arrays (JSON-darstellbar). */
export function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message ?? "ungleich"}: ${a} !== ${b}`);
}
