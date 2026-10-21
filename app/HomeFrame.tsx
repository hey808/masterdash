"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Frame } from "@/lib/timeframe";
import TimeFrame from "./TimeFrame";

/** Home's time frame: lives in the URL so the server computes the numbers. */
export default function HomeFrame({ frame, from, to }: { frame: Frame; from: string; to: string }) {
  const router = useRouter();
  const [state, setState] = useState({ frame, from, to });
  return (
    <TimeFrame
      frame={state.frame}
      from={state.from}
      to={state.to}
      onChange={(f, a, b) => {
        setState({ frame: f, from: a, to: b });
        // A custom range waits until both ends are picked.
        if (f === "custom" && !(a && b)) return;
        const q = new URLSearchParams({ frame: f });
        if (f === "custom") {
          q.set("from", a);
          q.set("to", b);
        }
        router.push(`/?${q}`);
      }}
    />
  );
}
