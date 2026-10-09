import { createContext, useContext } from "react";

/**
 * Who is looking at Taxes & Books. The owner sees everything; the finance
 * bookkeeper can read and record but not delete, and doesn't get Cleo (the
 * admin assistant). The server and RLS enforce the same split.
 */
export type BooksMode = "owner" | "finance";

export const BooksModeContext = createContext<BooksMode>("owner");

export function useBooksMode(): BooksMode {
  return useContext(BooksModeContext);
}
