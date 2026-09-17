/**
 * @neer/shared — the contract layer.
 *
 * Every type crossing the API boundary is defined here once, as a Zod schema,
 * and both the NestJS API and the React dashboard compile against it. The schema
 * is the source of truth and the runtime validator simultaneously, so a contract
 * change that breaks a consumer fails at build time rather than as a blank chart
 * in a demo.
 */

export * from './enums';
export * from './site';
export * from './observation';
export * from './health';
export * from './insight';
export * from './api';
