import { parseDateMs } from '../utils.js';

export const getRiderJobIncome = (job, appConfig) => {
  if (typeof job.riderIncome === 'number') return job.riderIncome;

  const gpByType = {
    parcel: appConfig.gpDelivery ?? 15,
    ride: appConfig.gpRide ?? 15,
    service: appConfig.gpService ?? 15,
  };
  if (Object.hasOwn(gpByType, job.type)) {
    const gross = job.type === 'parcel'
      ? (job.deliveryFee || job.grandTotal || 0)
      : (job.grandTotal || job.deliveryFee || 0);
    return gross * (1 - gpByType[job.type] / 100);
  }
  return job.deliveryFee || 0;
};

export const getRiderJobDoneMs = (job) => {
  if (typeof job.deliveredAtMs === 'number') return job.deliveredAtMs;
  if (typeof job.completedAtMs === 'number') return job.completedAtMs;

  for (const value of [job.deliveredAt, job.completedAt]) {
    const ms = parseDateMs(value);
    if (!Number.isNaN(ms)) return ms;
  }
  if (typeof job.createdAtMs === 'number') return job.createdAtMs;
  const fallback = parseDateMs(job.createdAt || job.timestamp);
  return Number.isNaN(fallback) ? NaN : fallback;
};
