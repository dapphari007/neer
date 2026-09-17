import { Injectable } from '@nestjs/common';
import {
  ForecastProvider,
  type ForecastPoint,
  type ForecastRequest,
  type ForecastResult,
} from './forecast.interface';

/**
 * Holt's linear trend method — double exponential smoothing with a damped trend.
 *
 * This is the default provider, and it is chosen to be defensible rather than
 * impressive. Citizen observation series are short, gappy and irregular: at most
 * a few hundred points per site, many days missing entirely. Fitting a seasonal
 * ARIMA to that produces confident-looking output whose intervals are not
 * honest, because the model has nowhere near the data its assumptions require.
 *
 * Holt's method needs only a level and a trend, degrades gracefully on short
 * series, and its prediction intervals come from observed one-step-ahead
 * residuals rather than from a distributional assumption the data cannot
 * support.
 *
 * The trend is **damped** (φ < 1). Undamped linear extrapolation of a stream
 * health index is actively misleading: a fortnight of decline projected straight
 * out reaches zero inside two months, which is not a forecast but an artefact of
 * the functional form. Damping makes the projection flatten toward a plateau,
 * which is both the empirically better-performing choice for short horizons and
 * the more honest one.
 */
@Injectable()
export class LocalForecastProvider extends ForecastProvider {
  readonly name = 'local-holt-damped';
  private readonly version = '1.0.0';

  /** Level smoothing. */
  private readonly alpha = 0.3;
  /** Trend smoothing — low, because citizen series are noisy. */
  private readonly beta = 0.1;
  /** Trend damping. */
  private readonly phi = 0.85;

  /** Always available: no credentials, no network, no external service. */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async forecast(request: ForecastRequest): Promise<ForecastResult> {
    const history = request.history.filter((p) => Number.isFinite(p.value));

    // Below this, a "forecast" would be an extrapolation from noise. Returning
    // nothing with a reason is more useful than returning a line with an
    // interval wide enough to contain every possible outcome.
    if (history.length < 10) {
      return {
        points: [],
        model: this.name,
        modelVersion: this.version,
        trainedThrough: history.at(-1)?.day ?? null,
        note: `Only ${history.length} observation day(s) available; at least 10 are needed before a forecast is meaningful.`,
      };
    }

    const values = history.map((p) => p.value);

    // ─── Fit, recording one-step-ahead residuals as we go ────────────────────
    let level = values[0]!;
    let trend = values[1]! - values[0]!;
    const residuals: number[] = [];

    for (let i = 1; i < values.length; i++) {
      const forecastForI = level + this.phi * trend;
      residuals.push(values[i]! - forecastForI);

      const previousLevel = level;
      level = this.alpha * values[i]! + (1 - this.alpha) * (level + this.phi * trend);
      trend = this.beta * (level - previousLevel) + (1 - this.beta) * this.phi * trend;
    }

    // Residual standard deviation is the empirical one-step error of this model
    // on this series — no normality assumed about the data itself, only about
    // how the error accumulates over the horizon.
    const meanResidual = residuals.reduce((s, r) => s + r, 0) / residuals.length;
    const variance =
      residuals.reduce((s, r) => s + (r - meanResidual) ** 2, 0) / Math.max(1, residuals.length - 1);
    const sigma = Math.sqrt(variance);

    const lastDay = history.at(-1)!.day;
    const points: ForecastPoint[] = [];
    let cumulativeDamping = 0;

    for (let h = 1; h <= request.horizonDays; h++) {
      // Damped trend: the h-step forecast adds φ + φ² + … + φʰ of the trend,
      // a geometric series that converges rather than growing without bound.
      cumulativeDamping += this.phi ** h;
      const predicted = level + cumulativeDamping * trend;

      // Uncertainty grows with the square root of the horizon, as it does for a
      // random walk — errors accumulate, but not linearly.
      const horizonSigma = sigma * Math.sqrt(h);

      points.push({
        targetDate: addDays(lastDay, h),
        predicted: clamp(predicted),
        lower80: clamp(predicted - 1.2816 * horizonSigma),
        upper80: clamp(predicted + 1.2816 * horizonSigma),
        lower95: clamp(predicted - 1.96 * horizonSigma),
        upper95: clamp(predicted + 1.96 * horizonSigma),
      });
    }

    return {
      points,
      model: this.name,
      modelVersion: this.version,
      trainedThrough: lastDay,
    };
  }
}

/** The index is bounded 0–100; a forecast outside that range is not meaningful. */
const clamp = (v: number): number => Math.max(0, Math.min(100, Number(v.toFixed(2))));

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
