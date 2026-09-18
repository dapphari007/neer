/**
 * Where the source lives.
 *
 * One constant, so the footer, the method page and the share caption cannot
 * drift apart. Override at build time with VITE_REPO_URL if the repository
 * moves.
 */
export const REPO_URL: string =
  (import.meta.env.VITE_REPO_URL as string | undefined) ?? 'https://github.com/dapphari007/neer';

/** The whole stack from a clean clone: no accounts, no keys. */
export const SETUP_COMMAND = `git clone ${REPO_URL}.git\ncd neer\ndocker compose up`;
