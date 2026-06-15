import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Sensible defaults so the same data doesn't get refetched on every mount,
  // tab focus, or remount during a single client/member session. Individual
  // queries can still opt in to fresher behaviour by overriding staleTime.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,           // treat data as fresh for 30s
        gcTime: 5 * 60_000,          // keep cached data for 5min after unmount
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
    defaultPreloadStaleTime: 0,
  });

  return router;
};
