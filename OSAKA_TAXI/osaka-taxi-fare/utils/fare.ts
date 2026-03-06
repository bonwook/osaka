export interface FareCalculation {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surcharge: number;
  totalJPY: number;
  totalKRW: number;
  exchangeRate: number;
  isNightSurcharge: boolean;
  accuracyLevel: string;
  isAirportRoute?: boolean;
  airportNotice?: string;
}

export const EXCHANGE_RATE = 9.2;

const BASE_FARE = 600;
const BASE_DISTANCE_METERS = 1300;
const ADDITIONAL_DISTANCE_METERS = 260;
const ADDITIONAL_FARE = 100;
const NIGHT_SURCHARGE_RATE = 0.2;
const LOW_SPEED_THRESHOLD_KMH = 10;
const TIME_FARE_PER_95_SECONDS = 100;
const LOW_SPEED_DURATION_RATIO = 0.3;

function isNightTime(): boolean {
  const now = new Date();
  const osakaOffset = 9 * 60;
  const localOffset = now.getTimezoneOffset();
  const osakaTime = new Date(now.getTime() + (osakaOffset + localOffset) * 60 * 1000);
  const hour = osakaTime.getHours();
  return hour >= 22 || hour < 5;
}

function roundToNearest10(value: number): number {
  return Math.round(value / 10) * 10;
}

function isAirportRoute(pickup: string, dropoff: string): boolean {
  const airportKeywords = ['kansai international airport', '関西国際空港', 'kix'];
  const locations = [pickup.toLowerCase(), dropoff.toLowerCase()];
  return locations.some(loc => airportKeywords.some(keyword => loc.includes(keyword)));
}

export function calculateOsakaFare(
  distanceInMeters: number,
  durationInSeconds: number,
  pickup: string = '',
  dropoff: string = '',
  exchangeRate: number = EXCHANGE_RATE
): FareCalculation {
  const baseFare = BASE_FARE;

  let distanceFare = 0;
  if (distanceInMeters > BASE_DISTANCE_METERS) {
    const additionalDistance = distanceInMeters - BASE_DISTANCE_METERS;
    const additionalUnits = Math.ceil(additionalDistance / ADDITIONAL_DISTANCE_METERS);
    distanceFare = additionalUnits * ADDITIONAL_FARE;
  }

  let timeFare = 0;
  if (durationInSeconds > 0) {
    const distanceInKm = distanceInMeters / 1000;
    const durationInHours = durationInSeconds / 3600;
    const avgSpeedKmh = distanceInKm / durationInHours;

    if (avgSpeedKmh < LOW_SPEED_THRESHOLD_KMH) {
      const lowSpeedDuration = durationInSeconds * LOW_SPEED_DURATION_RATIO;
      const timeUnits = Math.floor(lowSpeedDuration / 95);
      timeFare = timeUnits * TIME_FARE_PER_95_SECONDS;
    }
  }

  const fareBeforeSurcharge = baseFare + distanceFare + timeFare;

  const nightTime = isNightTime();
  const surcharge = nightTime
    ? Math.round(fareBeforeSurcharge * NIGHT_SURCHARGE_RATE)
    : 0;

  const totalBeforeRounding = fareBeforeSurcharge + surcharge;
  const totalJPY = roundToNearest10(totalBeforeRounding);
  const totalKRW = Math.round(totalJPY * exchangeRate);

  const isAirport = isAirportRoute(pickup, dropoff);

  return {
    baseFare,
    distanceFare,
    timeFare,
    surcharge,
    totalJPY,
    totalKRW,
    exchangeRate,
    isNightSurcharge: nightTime,
    accuracyLevel: 'Estimated 90–95%',
    isAirportRoute: isAirport,
    airportNotice: isAirport
      ? 'Note: Kansai International Airport may have flat fare options available. The fare shown is based on standard metered calculation.'
      : undefined,
  };
}
