import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouterErrorFallback } from "./components/router-error-fallback";

export const getRouter = () => {
  // Sensible defaults so the same data doesn't get refetched on every mount,
  // tab focus, or remount during a single client/member session. Individual
  // queries can still opt in to fresher behaviour by overriding staleTime.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000,       // treat data as fresh for 2min
        gcTime: 10 * 60_000,         // keep cached data for 10min after unmount
        refetchOnWindowFocus: false, // don't refetch on every tab switch
        refetchOnReconnect: "always",
        retry: 1,                    // a single retry instead of the default 3
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload the next route's code + loader data the moment a user
    // hovers or touch-starts a link. This is the single biggest win for
    // "toggling between pages feels slow" — by the time they actually
    // tap, the data is usually already in cache.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
    // Keep the previous page on screen briefly while the next one
    // resolves, instead of flashing a blank/skeleton frame. Anything
    // slower than 400ms still shows the route's pendingComponent.
    defaultPendingMs: 400,
    defaultPendingMinMs: 200,
    defaultErrorComponent: RouterErrorFallback,
  });

  return router;
};
