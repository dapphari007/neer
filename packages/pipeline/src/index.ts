/**
 * @neer/pipeline — ingestion and scoring shared by the batch tools and the
 * live API.
 *
 * Everything here talks to ClickHouse or to an upstream network; the science it
 * calls into (@neer/scoring, @neer/insights) stays pure. One scoring function
 * serves both the nightly-style batch and the seconds-later incremental path,
 * so the two can never disagree.
 */

export * from './rows';
export * from './weather';
export * from './scoring';
export * from './sensors/ea';
export * from './import/oahCsv';
