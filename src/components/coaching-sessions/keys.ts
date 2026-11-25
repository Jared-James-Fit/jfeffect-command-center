/** The Meetings tab's query keys, shared by its components. */
export const meetingsKey = (clientId: string) => ["coaching-meetings", clientId] as const;
export const sessionKey = (id: string) => ["coaching-session", id] as const;
