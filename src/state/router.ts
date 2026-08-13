/**
 * Hash routing, hand-rolled — seven screens do not justify a router dependency,
 * and a hash keeps the build deployable from any static path.
 */
import { useCallback, useEffect, useState } from "react";

export const SCREENS = ["welcome", "account", "collection", "build", "upgrade", "strategy", "banlist"] as const;
export type Screen = (typeof SCREENS)[number];

export interface Route {
  screen: Screen;
  /** Optional second segment, e.g. the template id on Strategy and Upgrade. */
  param: string | null;
}

export function parseHash(hash: string): Route {
  const [rawScreen = "", rawParam = ""] = hash.replace(/^#\/?/, "").split("/");
  const screen = (SCREENS as readonly string[]).includes(rawScreen) ? (rawScreen as Screen) : "welcome";
  return { screen, param: rawParam ? decodeURIComponent(rawParam) : null };
}

export function href(screen: Screen, param?: string): string {
  return param ? `#/${screen}/${encodeURIComponent(param)}` : `#/${screen}`;
}

export function useRoute(): { route: Route; navigate: (screen: Screen, param?: string) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((screen: Screen, param?: string) => {
    window.location.hash = href(screen, param);
  }, []);

  return { route, navigate };
}
