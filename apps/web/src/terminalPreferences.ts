import * as Schema from "effect/Schema";
import { getLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useMemo } from "react";

const LAST_TERMINAL_KEY = "t3code:last-terminal";
const StoredTerminal = Schema.NullOr(Schema.String);

export function getStoredPreferredTerminal(): string | null {
  return getLocalStorageItem(LAST_TERMINAL_KEY, StoredTerminal) ?? null;
}

export function usePreferredTerminal(availableTerminals: ReadonlyArray<string>) {
  const [lastTerminal, setLastTerminal] = useLocalStorage(LAST_TERMINAL_KEY, null, StoredTerminal);

  const effectiveTerminal = useMemo(() => {
    if (lastTerminal && availableTerminals.includes(lastTerminal)) return lastTerminal;
    return availableTerminals[0] ?? null;
  }, [lastTerminal, availableTerminals]);

  return [effectiveTerminal, setLastTerminal] as const;
}
