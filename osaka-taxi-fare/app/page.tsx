'use client';

import { useState, useEffect, useRef } from 'react';
import Script from 'next/script';
import styles from './page.module.css';

interface FareResult {
  distance: number;
  duration: number;
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

interface Suggestion {
  place_name: string;
  center: [number, number]; // [lng, lat]
}

const OSAKA_CENTER: [number, number] = [34.6937, 135.5023]; // [lat, lng] for Leaflet

const faqStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "간사이 공항에서 난바까지 택시 요금은 얼마인가요?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "간사이 국제공항에서 난바까지 택시 요금은 교통 상황과 경로에 따라 약 13,000~18,000엔입니다. 거리는 약 50km이며 50~70분 소요됩니다."
      }
    },
    {
      "@type": "Question",
      "name": "오사카 택시는 비싼가요?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "오사카 택시는 첫 1.3km에 600엔으로 시작하며, 이는 일본 주요 도시의 표준 요금입니다. 3km 미만의 짧은 거리는 합리적이지만, 장거리는 그룹 여행이나 짐이 많은 경우가 아니라면 기차가 더 경제적입니다."
      }
    }
  ]
};

const webAppStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "오사카 택시 요금 계산기",
  "description": "지도에서 출발지와 도착지를 클릭하거나 검색하여 정확한 오사카 택시 요금을 즉시 계산하세요",
  "applicationCategory": "UtilityApplication",
  "operatingSystem": "Any"
};

export default function Home() {
  const [pickupLocation, setPickupLocation] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [dropoffLocation, setDropoffLocation] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [result, setResult] = useState<FareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickupQuery, setPickupQuery] = useState('');
  const [dropoffQuery, setDropoffQuery] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<Suggestion[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<Suggestion[]>([]);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const dropoffMarkerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const pickupSetRef = useRef(false);
  const dropoffSetRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectMode = !pickupLocation ? 'pickup' : !dropoffLocation ? 'dropoff' : null;

  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;

    import('leaflet').then((mod) => {
      const L = mod.default;
      LRef.current = L;

      // 기본 마커 아이콘 경로 수정 (Next.js 빌드 환경 대응)
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      mapInstanceRef.current = L.map(mapRef.current!).setView(OSAKA_CENTER, 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      mapInstanceRef.current.on('click', (e: any) => {
        handleMapClick(e.latlng.lat, e.latlng.lng);
      });
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const handleMapClick = async (lat: number, lng: number) => {
    if (pickupSetRef.current && dropoffSetRef.current) {
      alert('두 지점이 모두 선택되었습니다. "다시 선택" 버튼을 눌러주세요.');
      return;
    }
    const address = await reverseGeocode(lat, lng);
    if (!pickupSetRef.current) {
      placePickupMarker(lat, lng, address);
    } else {
      placeDropoffMarker(lat, lng, address);
    }
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`,
        { headers: { 'User-Agent': 'OsakaTaxiFareCalculator/1.0' } }
      );
      const data = await res.json();
      return data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  };

  const fetchSuggestions = async (query: string, type: 'pickup' | 'dropoff') => {
    if (!query.trim() || query.length < 2) {
      type === 'pickup' ? setPickupSuggestions([]) : setDropoffSuggestions([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: '5',
        countrycodes: 'jp',
        'accept-language': 'ja,ko',
        viewbox: '135.0,35.0,135.8,34.3',
        bounded: '0',
      });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { headers: { 'User-Agent': 'OsakaTaxiFareCalculator/1.0' } }
      );
      const data = await res.json();
      const suggestions: Suggestion[] = data.map((item: any) => ({
        place_name: item.display_name,
        center: [parseFloat(item.lon), parseFloat(item.lat)] as [number, number],
      }));
      type === 'pickup' ? setPickupSuggestions(suggestions) : setDropoffSuggestions(suggestions);
    } catch {
      // 네트워크 오류 시 무시
    }
  };

  const handleQueryChange = (value: string, type: 'pickup' | 'dropoff') => {
    type === 'pickup' ? setPickupQuery(value) : setDropoffQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value, type), 500);
  };

  const selectSuggestion = (suggestion: Suggestion, type: 'pickup' | 'dropoff') => {
    const [lng, lat] = suggestion.center;
    const address = suggestion.place_name;
    if (type === 'pickup') {
      placePickupMarker(lat, lng, address);
      setPickupSuggestions([]);
    } else {
      placeDropoffMarker(lat, lng, address);
      setDropoffSuggestions([]);
    }
    mapInstanceRef.current?.flyTo([lat, lng], 15);
  };

  const createMarkerIcon = (label: string, color: string) => {
    const L = LRef.current;
    if (!L) return undefined;
    return L.divIcon({
      html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};color:white;font-weight:bold;display:flex;align-items:center;justify-content:center;font-size:14px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);">${label}</div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  const placePickupMarker = (lat: number, lng: number, address: string) => {
    const L = LRef.current;
    if (!L || !mapInstanceRef.current) return;
    if (pickupMarkerRef.current) mapInstanceRef.current.removeLayer(pickupMarkerRef.current);
    pickupMarkerRef.current = L.marker([lat, lng], { icon: createMarkerIcon('A', '#4CAF50') })
      .addTo(mapInstanceRef.current);
    pickupSetRef.current = true;
    setPickupLocation({ lat, lng, address });
    setPickupQuery(address);
  };

  const placeDropoffMarker = (lat: number, lng: number, address: string) => {
    const L = LRef.current;
    if (!L || !mapInstanceRef.current) return;
    if (dropoffMarkerRef.current) mapInstanceRef.current.removeLayer(dropoffMarkerRef.current);
    dropoffMarkerRef.current = L.marker([lat, lng], { icon: createMarkerIcon('B', '#F44336') })
      .addTo(mapInstanceRef.current);
    dropoffSetRef.current = true;
    setDropoffLocation({ lat, lng, address });
    setDropoffQuery(address);
  };

  const showRouteOnMap = async (
    pickup: { lat: number; lng: number },
    dropoff: { lat: number; lng: number }
  ) => {
    const L = LRef.current;
    if (!L || !mapInstanceRef.current) return;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      const geometry = data.routes?.[0]?.geometry;
      if (!geometry) return;

      if (routeLayerRef.current) mapInstanceRef.current.removeLayer(routeLayerRef.current);

      // GeoJSON 좌표는 [lng, lat] → Leaflet은 [lat, lng]
      const coords: [number, number][] = geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng]
      );
      routeLayerRef.current = L.polyline(coords, {
        color: '#4a90e2',
        weight: 5,
        opacity: 0.85,
      }).addTo(mapInstanceRef.current);

      mapInstanceRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
    } catch {
      // 경로 표시 실패 시 무시
    }
  };

  const handleCalculate = async () => {
    if (!pickupLocation || !dropoffLocation) return;
    setLoading(true);
    try {
      const response = await fetch('/api/calc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupLat: pickupLocation.lat,
          pickupLng: pickupLocation.lng,
          dropoffLat: dropoffLocation.lat,
          dropoffLng: dropoffLocation.lng,
          pickupAddress: pickupLocation.address,
          dropoffAddress: dropoffLocation.address,
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      await showRouteOnMap(pickupLocation, dropoffLocation);
    } catch {
      alert('요금 계산에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setPickupLocation(null);
    setDropoffLocation(null);
    setResult(null);
    setPickupQuery('');
    setDropoffQuery('');
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
    pickupSetRef.current = false;
    dropoffSetRef.current = false;
    if (mapInstanceRef.current) {
      if (pickupMarkerRef.current) mapInstanceRef.current.removeLayer(pickupMarkerRef.current);
      if (dropoffMarkerRef.current) mapInstanceRef.current.removeLayer(dropoffMarkerRef.current);
      if (routeLayerRef.current) mapInstanceRef.current.removeLayer(routeLayerRef.current);
    }
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    routeLayerRef.current = null;
  };

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <Script
        id="faq-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <Script
        id="webapp-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppStructuredData) }}
      />

      <div className={styles.container}>
        <main className={styles.main}>
          <header className={styles.header}>
            <h1>🚕 오사카 택시 요금 계산기</h1>
            <p className={styles.subtitle}>주소를 검색하거나 지도를 클릭하여 출발지·도착지를 선택하세요</p>
          </header>

          <section className={styles.controlSection}>
            <div className={styles.locationInfo}>
              <div className={styles.locationItem}>
                <div className={styles.locationLabel}>
                  <span className={styles.markerIcon} style={{ backgroundColor: '#4CAF50' }}>A</span>
                  <strong>출발지</strong>
                  {selectMode === 'pickup' && <span className={styles.selectingBadge}>선택 중...</span>}
                </div>
                <div className={styles.searchWrapper}>
                  <input
                    type="text"
                    value={pickupQuery}
                    onChange={(e) => handleQueryChange(e.target.value, 'pickup')}
                    onFocus={() => pickupQuery.length >= 2 && fetchSuggestions(pickupQuery, 'pickup')}
                    onBlur={() => setTimeout(() => setPickupSuggestions([]), 150)}
                    placeholder="출발지 검색 또는 지도 클릭"
                    className={styles.searchInput}
                  />
                  {pickupSuggestions.length > 0 && (
                    <ul className={styles.suggestionsList}>
                      {pickupSuggestions.map((s, i) => (
                        <li
                          key={i}
                          className={styles.suggestionItem}
                          onMouseDown={() => selectSuggestion(s, 'pickup')}
                        >
                          {s.place_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className={styles.locationItem}>
                <div className={styles.locationLabel}>
                  <span className={styles.markerIcon} style={{ backgroundColor: '#F44336' }}>B</span>
                  <strong>도착지</strong>
                  {selectMode === 'dropoff' && <span className={styles.selectingBadge}>선택 중...</span>}
                </div>
                <div className={styles.searchWrapper}>
                  <input
                    type="text"
                    value={dropoffQuery}
                    onChange={(e) => handleQueryChange(e.target.value, 'dropoff')}
                    onFocus={() => dropoffQuery.length >= 2 && fetchSuggestions(dropoffQuery, 'dropoff')}
                    onBlur={() => setTimeout(() => setDropoffSuggestions([]), 150)}
                    placeholder="도착지 검색 또는 지도 클릭"
                    className={styles.searchInput}
                  />
                  {dropoffSuggestions.length > 0 && (
                    <ul className={styles.suggestionsList}>
                      {dropoffSuggestions.map((s, i) => (
                        <li
                          key={i}
                          className={styles.suggestionItem}
                          onMouseDown={() => selectSuggestion(s, 'dropoff')}
                        >
                          {s.place_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.buttonGroup}>
              <button
                onClick={handleCalculate}
                disabled={!pickupLocation || !dropoffLocation || loading}
                className={styles.calculateButton}
              >
                {loading ? '계산 중...' : '💰 요금 계산하기'}
              </button>
              <button onClick={handleReset} className={styles.resetButton}>
                🔄 다시 선택
              </button>
            </div>
          </section>

          <div ref={mapRef} className={styles.mapContainer} />

          {result && (
            <>
              <section className={styles.resultCard}>
                <h2>📊 예상 요금</h2>

                <div className={styles.surchargeStatus}>
                  {result.isNightSurcharge
                    ? <span className={styles.nightBadge}>🌙 심야 할증 포함 (22:00~05:00, +20%)</span>
                    : <span className={styles.dayBadge}>☀️ 일반 요금 (심야 할증 없음)</span>
                  }
                </div>

                {result.isAirportRoute && result.airportNotice && (
                  <div className={styles.airportNotice}>
                    ✈️ 간사이 공항은 정액 요금 옵션이 있을 수 있습니다. 표시된 요금은 일반 미터기 기준입니다.
                  </div>
                )}

                <dl className={styles.resultList}>
                  <div className={styles.resultRow}>
                    <dt className={styles.label}>거리</dt>
                    <dd className={styles.value}>{(result.distance / 1000).toFixed(2)} km</dd>
                  </div>
                  <div className={styles.resultRow}>
                    <dt className={styles.label}>소요 시간</dt>
                    <dd className={styles.value}>{Math.round(result.duration / 60)} 분</dd>
                  </div>
                  {result.timeFare > 0 && (
                    <div className={styles.resultRow}>
                      <dt className={styles.label}>교통 체증 요금</dt>
                      <dd className={styles.value}>¥{result.timeFare.toLocaleString()}</dd>
                    </div>
                  )}
                  {result.surcharge > 0 && (
                    <div className={styles.resultRow}>
                      <dt className={styles.label}>심야 할증 (+20%)</dt>
                      <dd className={styles.value}>¥{result.surcharge.toLocaleString()}</dd>
                    </div>
                  )}
                  <div className={styles.resultRowHighlight}>
                    <dt className={styles.label}>예상 요금 (엔)</dt>
                    <dd className={styles.valueHighlight}>¥{result.totalJPY.toLocaleString()}</dd>
                  </div>
                  <div className={styles.resultRowHighlight}>
                    <dt className={styles.label}>
                      예상 요금 (원)
                      <span className={styles.rateLabel}>1엔 = {result.exchangeRate.toFixed(2)}원</span>
                    </dt>
                    <dd className={styles.valueHighlight}>₩{result.totalKRW.toLocaleString()}</dd>
                  </div>
                </dl>

                <div className={styles.accuracyNote}>
                  <p><strong>🎯 정확도:</strong> {result.accuracyLevel}</p>
                  <p className={styles.disclaimer}>
                    ⚠️ 실제 요금은 교통 상황과 경로에 따라 ±5~10% 차이가 날 수 있습니다.
                  </p>
                </div>
              </section>

              <div className={styles.adsenseSlot}>
                <p>📢 광고 영역</p>
              </div>
            </>
          )}

          <section id="fare-guide" className={styles.contentSection}>
            <h2>💡 오사카 택시 요금 가이드</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoCard}>
                <h3>🏁 기본 요금</h3>
                <p className={styles.fareAmount}>600엔</p>
                <p className={styles.fareDetail}>첫 1.3km</p>
              </div>
              <div className={styles.infoCard}>
                <h3>➕ 추가 요금</h3>
                <p className={styles.fareAmount}>100엔</p>
                <p className={styles.fareDetail}>260m마다</p>
              </div>
              <div className={styles.infoCard}>
                <h3>🌙 심야 할증</h3>
                <p className={styles.fareAmount}>+20%</p>
                <p className={styles.fareDetail}>22:00~05:00</p>
              </div>
              <div className={styles.infoCard}>
                <h3>🚦 교통 체증</h3>
                <p className={styles.fareAmount}>100엔</p>
                <p className={styles.fareDetail}>95초마다 (저속)</p>
              </div>
            </div>
            <div className={styles.guideContent}>
              <h3>📍 인기 경로</h3>
              <ul className={styles.routeList}>
                <li>
                  <strong>간사이 공항 → 난바</strong>
                  <span className={styles.routeFare}>약 ¥13,000~18,000</span>
                </li>
                <li>
                  <strong>우메다 → 도톤보리</strong>
                  <span className={styles.routeFare}>약 ¥1,200~1,800</span>
                </li>
                <li>
                  <strong>신오사카역 → 난바</strong>
                  <span className={styles.routeFare}>약 ¥2,200~3,000</span>
                </li>
              </ul>
            </div>
          </section>

          <section id="faq" className={styles.faqSection}>
            <h2>❓ 자주 묻는 질문</h2>
            <details className={styles.faqItem}>
              <summary>간사이 공항에서 난바까지 택시 요금은 얼마인가요?</summary>
              <p>간사이 국제공항에서 난바까지 택시 요금은 교통 상황과 경로에 따라 약 <strong>13,000~18,000엔</strong>입니다. 거리는 약 50km이며 50~70분이 소요됩니다.</p>
            </details>
            <details className={styles.faqItem}>
              <summary>오사카 택시는 비싼가요?</summary>
              <p>오사카 택시는 <strong>첫 1.3km에 600엔</strong>으로 시작하며, 이는 일본 주요 도시의 표준입니다. 3km 미만의 짧은 거리는 1,000~1,500엔 정도로 합리적입니다.</p>
            </details>
            <details className={styles.faqItem}>
              <summary>오사카 택시에서 신용카드를 사용할 수 있나요?</summary>
              <p>네, 대부분의 오사카 택시는 <strong>신용카드, IC 카드(Suica, ICOCA 등), 현금</strong>을 받습니다. 탑승 전에 기사에게 확인하는 것이 좋습니다.</p>
            </details>
            <details className={styles.faqItem}>
              <summary>심야 할증 요금은 어떻게 되나요?</summary>
              <p>오사카 택시는 <strong>22:00부터 05:00 사이에 20% 할증</strong>을 적용합니다. 예를 들어, 2,000엔의 주간 요금은 심야 시간대에 2,400엔이 됩니다.</p>
            </details>
            <details className={styles.faqItem}>
              <summary>이 계산기는 얼마나 정확한가요?</summary>
              <p>이 계산기는 실시간 지도 데이터와 공식 오사카 택시 요금을 사용하여 <strong>90~95%의 정확도</strong>를 제공합니다. 실제 요금은 교통 상황에 따라 ±5~10% 차이가 날 수 있습니다.</p>
            </details>
          </section>

          <div className={styles.adsenseSlot}>
            <p>📢 광고 영역</p>
          </div>

          <footer className={styles.footer}>
            <nav className={styles.footerNav}>
              <a href="#calculator">계산기</a>
              <a href="#fare-guide">요금 가이드</a>
              <a href="#faq">FAQ</a>
            </nav>
            <p className={styles.copyright}>© 2026 오사카 택시 요금 계산기. All rights reserved.</p>
          </footer>
        </main>
      </div>
    </>
  );
}
