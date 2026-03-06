import { NextRequest, NextResponse } from 'next/server';
import { calculateOsakaFare, EXCHANGE_RATE } from '@/utils/fare';

export async function POST(request: NextRequest) {
  const {
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    pickupAddress = '',
    dropoffAddress = '',
  } = await request.json();

  if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
    return NextResponse.json({ error: '출발지와 도착지 좌표가 필요합니다.' }, { status: 400 });
  }

  // OSRM 공개 라우팅 API (무료, API 키 불필요)
  const url = `https://router.project-osrm.org/route/v1/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?overview=false`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'OsakaTaxiFareCalculator/1.0' },
  });
  const data = await response.json();

  const route = data.routes?.[0];
  if (!route) {
    return NextResponse.json({ error: '경로를 찾을 수 없습니다.' }, { status: 400 });
  }

  const distanceInMeters: number = route.distance;
  const durationInSeconds: number = route.duration;

  // 실시간 환율 조회 (JPY → KRW), 실패 시 정적 기본값 사용
  let exchangeRate = EXCHANGE_RATE;
  try {
    const rateRes = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.json',
      { next: { revalidate: 3600 } } // 1시간 캐시
    );
    const rateData = await rateRes.json();
    const krwRate = rateData?.jpy?.krw;
    if (krwRate && krwRate > 0) exchangeRate = krwRate;
  } catch {
    // 네트워크 오류 시 정적 환율 사용
  }

  const fareResult = calculateOsakaFare(distanceInMeters, durationInSeconds, pickupAddress, dropoffAddress, exchangeRate);

  return NextResponse.json({
    distance: distanceInMeters,
    duration: durationInSeconds,
    ...fareResult,
  });
}
