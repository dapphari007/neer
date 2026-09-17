import { z } from 'zod';

/**
 * Ecological status classes.
 *
 * These are the five classes of the EU Water Framework Directive, kept in the
 * WFD's own vocabulary rather than invented labels ("green/amber/red"). Anyone
 * already working to the Directive can read a Neer score without a translation
 * table, and the output slots into existing reporting rather than sitting
 * beside it.
 *
 * Ordered worst to best so numeric comparison matches semantic severity.
 */
export const StatusClass = z.enum(['bad', 'poor', 'moderate', 'good', 'high']);
export type StatusClass = z.infer<typeof StatusClass>;

export const STATUS_ORDER: readonly StatusClass[] = ['bad', 'poor', 'moderate', 'good', 'high'];

/** Severity of a finding. Drives alert ranking and UI prominence. */
export const Severity = z.enum(['info', 'watch', 'elevated', 'high']);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_ORDER: readonly Severity[] = ['info', 'watch', 'elevated', 'high'];

/**
 * A rule's confidence in its own assertion.
 *
 * Deliberately distinct from index confidence. A rule may fire on excellent data
 * while describing a mechanism that is merely plausible, or fire on a
 * well-established mechanism using thin data. Collapsing the two into one number
 * destroys the distinction that matters most to whoever has to act on it.
 */
export const RuleConfidence = z.enum(['low', 'medium', 'high']);
export type RuleConfidence = z.infer<typeof RuleConfidence>;

/** Which One Health domain a finding speaks to. */
export const FindingDomain = z.enum([
  'ecological',
  'pressure',
  'human_health',
  'animal_health',
  'data_quality',
]);
export type FindingDomain = z.infer<typeof FindingDomain>;

/** Catchment character, a structural driver of both pressure and exposure. */
export const UrbanClass = z.enum(['urban_core', 'peri_urban', 'semi_natural']);
export type UrbanClass = z.infer<typeof UrbanClass>;

/**
 * Observer experience level, the primary input to observation reliability
 * weighting. `instrument` denotes an automated sensor rather than a person.
 */
export const ObserverExperience = z.enum(['novice', 'trained', 'expert', 'instrument']);
export type ObserverExperience = z.infer<typeof ObserverExperience>;

/** How a measurement was taken — bounds its plausible precision. */
export const MeasurementMethod = z.enum(['citizen_kit', 'handheld_probe', 'sensor', 'lab']);
export type MeasurementMethod = z.infer<typeof MeasurementMethod>;

/** Field-observable categoricals, matching real citizen-science protocols. */
export const WaterColour = z.enum(['clear', 'slightly_turbid', 'murky', 'discoloured']);
export type WaterColour = z.infer<typeof WaterColour>;

export const Odour = z.enum(['none', 'earthy', 'sewage', 'chemical']);
export type Odour = z.infer<typeof Odour>;

export const FlowState = z.enum(['dry', 'stagnant', 'low', 'normal', 'high']);
export type FlowState = z.infer<typeof FlowState>;

/** The three audiences a finding is rendered for. */
export const Audience = z.enum(['citizen', 'municipal', 'health']);
export type Audience = z.infer<typeof Audience>;

/** Sub-indices of the composite index. */
export const SubIndex = z.enum(['ecological', 'pressure', 'exposure']);
export type SubIndex = z.infer<typeof SubIndex>;
