/**
 * @neer/scoring — the Stream One Health Index.
 *
 * This package is deliberately pure: no database, no HTTP, no clock, no
 * environment access. Every function is a total function of its arguments.
 *
 * That constraint is what makes the science reviewable. An index whose logic is
 * tangled through query builders and service classes cannot be audited by a
 * domain expert who does not read TypeScript infrastructure, and cannot be
 * tested at its boundaries without standing up a database. Here, a scientist can
 * read one file per concept, and every threshold carries a provenance tag saying
 * whether it came from a standard or from us.
 */

export * from './provenance';
export * from './ccme';
export * from './biotic';
export * from './qbr';
export * from './ecological';
export * from './pressure';
export * from './exposure';
export * from './confidence';
export * from './sohi';
