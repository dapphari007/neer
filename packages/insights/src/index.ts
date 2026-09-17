/**
 * @neer/insights — the deterministic One Health rule engine.
 *
 * Pure, like @neer/scoring: rules are functions of a RuleContext with no I/O and
 * no clock. Nothing here calls a language model, and nothing here decides what is
 * true based on generated text.
 */

export * from './engine';
export * from './rules';
