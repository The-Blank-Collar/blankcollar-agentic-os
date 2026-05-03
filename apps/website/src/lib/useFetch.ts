import { useEffect, useRef, useState } from "react";

/**
 * Tiny async-state hook. `loader` runs whenever any element of `deps`
 * changes. The component is unmounted-safe — late-arriving promises that
 * resolve after unmount are dropped.
 *
 * Returns `{ data, error, loading, refetch }`. `data` stays `null` until
 * the first successful resolve; `error` is set if `loader` rejects.
 */
export function useFetch<T>(
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): { data: T | null; error: Error | null; loading: boolean; refetch: () => void } {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>(
    { data: null, error: null, loading: true },
  );
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => {
        if (!mounted.current) return;
        setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({ data: prev.data, error, loading: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, refetch: () => setTick((t) => t + 1) };
}
