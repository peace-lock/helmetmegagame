"use client";

import { createContext, useContext, useEffect, useState } from "react";

const PartySizeContext = createContext({ playerCount: 100, sizes: {} });

export function usePartySizes() {
  return useContext(PartySizeContext);
}

// Makes the live-computed Cult party-size thresholds available anywhere in
// the tree via context, so {partysize:N} references (see RichText.js) can
// resolve without every component threading them through props. Mirrors
// ProductionRatesProvider.js, which mirrors TagsProvider.js.
export default function PartySizeProvider({ children, sizesPromise }) {
  const [data, setData] = useState({ playerCount: 100, sizes: {} });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(sizesPromise)
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sizesPromise]);

  return <PartySizeContext.Provider value={data}>{children}</PartySizeContext.Provider>;
}
