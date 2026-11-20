/**
 * The name of the "make any missing feed copies now" event (catch-up.ts asks,
 * SetVideoResume listens). Its own file so the launch path never loads the
 * catch-up code just to listen.
 */
export const FEED_COPY_CATCH_UP_EVENT = "jf:feed-copy-catch-up";
