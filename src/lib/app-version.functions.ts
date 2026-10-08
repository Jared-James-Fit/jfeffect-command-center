import { createServerFn } from "@tanstack/react-start";

/** The build the server is running right now (= the latest publish). No auth: it's just an id. */
export const getLiveBuildId = createServerFn({ method: "POST" }).handler(async () => ({
  build: typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev",
}));
