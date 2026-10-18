/**
 * Where the client app opens: a client's or member's own launch, and every
 * "View as client" / member preview a coach enters, so the coach sees the app
 * the way the person does when they open it. (No imports: the old /m paths
 * and the push payloads use it too.)
 */
export const CLIENT_VIEW_HOME = "/portal/community" as const;
