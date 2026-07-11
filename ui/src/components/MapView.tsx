import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PlaceResult, UserLocation } from "../types";
import { useI18n } from "../i18n/LanguageContext";

const userIcon = L.divIcon({
  className: "user-location-marker",
  html: '<div class="user-dot"><span class="user-dot-pulse"></span></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Color by list rank rather than absolute score: real scores cluster in a
// narrow band (esp. with no user location), so absolute-score tiers all look
// identical. Rank tiers give a visible hierarchy tied to the numbered list —
// top 3 green, next 7 blue, the rest slate.
function rankTier(rank: number): string {
  if (rank <= 3) return "tier-high";
  if (rank <= 10) return "tier-mid";
  return "tier-low";
}

// Rank-numbered teardrop pin, colored by rank tier, enlarged + pulsing when
// selected. The rank number ties each map pin to its position in the list.
function poiIcon(rank: number, active: boolean) {
  return L.divIcon({
    className: "poi-marker",
    html: `<div class="poi-pin ${rankTier(rank)} ${active ? "poi-pin-active" : ""}"><span>${rank}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

// The bottom sheet covers ~½ the mobile viewport, so a plain flyTo(latlng)
// centers the POI right under the dock. Shift the map center DOWN so the POI
// lands in the upper third of the viewport instead. Desktop keeps the dock in
// a side column — no vertical shift needed there.
function upperThirdCenter(map: L.Map, latlng: L.LatLngExpression, zoom: number): L.LatLng {
  const size = map.getSize();
  const isMobile = size.x < 1024;
  const target = L.latLng(latlng as L.LatLngTuple);
  if (!isMobile) return target;
  const worldPoint = map.project(target, zoom);
  const offsetY = size.y / 6;
  return map.unproject(worldPoint.add([0, offsetY]), zoom);
}

function FitToResults({ results, userLoc, enabled }: { results: PlaceResult[]; userLoc: UserLocation | null; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return;
    const points: [number, number][] = results.map((r) => [r.coordinates.lat, r.coordinates.lon]);
    if (userLoc) points.push([userLoc.lat, userLoc.lon]);
    if (points.length === 0) return;
    if (points.length === 1) {
      const zoom = 15;
      map.setView(upperThirdCenter(map, points[0], zoom), zoom, { animate: true });
    } else {
      const isMobile = map.getSize().x < 1024;
      // Bigger bottom padding on mobile so results don't get crowded under the sheet.
      map.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [40, 40],
        paddingBottomRight: [40, isMobile ? Math.round(map.getSize().y * 0.5) : 40],
      });
    }
  }, [enabled, results, userLoc, map]);
  return null;
}

function FlyToUserLocation({ userLoc, enabled }: { userLoc: UserLocation | null; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || !userLoc) return;
    const zoom = Math.max(map.getZoom(), 16);
    map.flyTo(upperThirdCenter(map, [userLoc.lat, userLoc.lon], zoom), zoom, { duration: 0.8 });
  }, [enabled, userLoc, map]);
  return null;
}

function FlyToSelected({ results, selectedId }: { results: PlaceResult[]; selectedId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const r = results.find((x) => x.id === selectedId);
    if (!r) return;
    const zoom = Math.max(map.getZoom(), 14);
    map.flyTo(upperThirdCenter(map, [r.coordinates.lat, r.coordinates.lon], zoom), zoom, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  return null;
}

interface MapViewProps {
  results: PlaceResult[];
  userLoc: UserLocation | null;
  selectedId: string | null;
  satellite: boolean;
  focusMode: "results" | "user";
  onSelect: (id: string) => void;
}

export function MapView({ results, userLoc, selectedId, satellite, focusMode, onSelect }: MapViewProps) {
  const { t } = useI18n();
  const center: [number, number] = userLoc
    ? [userLoc.lat, userLoc.lon]
    : results[0]
      ? [results[0].coordinates.lat, results[0].coordinates.lon]
      : [21.0315, 105.8515];

  return (
    <MapContainer center={center} zoom={13} zoomControl={false} attributionControl={false} className="h-full w-full bg-muted">
      {satellite ? (
        <>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={20}
          />
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png" maxZoom={20} />
        </>
      ) : (
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png" maxZoom={20} />
      )}
      {userLoc && (
        <Marker position={[userLoc.lat, userLoc.lon]} icon={userIcon}>
          <Popup>{t("search.locate")}</Popup>
        </Marker>
      )}
      {results.map((r, idx) => (
        <Marker
          key={r.id}
          position={[r.coordinates.lat, r.coordinates.lon]}
          icon={poiIcon(idx + 1, r.id === selectedId)}
          zIndexOffset={r.id === selectedId ? 1000 : 0}
          eventHandlers={{ click: () => onSelect(r.id) }}
        >
          <Popup>
            <strong>{r.name}</strong>
            <br />
            {t("map.score")}: {r.score.toFixed(2)}
          </Popup>
        </Marker>
      ))}
      <FitToResults results={results} userLoc={userLoc} enabled={focusMode === "results"} />
      <FlyToUserLocation userLoc={userLoc} enabled={focusMode === "user"} />
      <FlyToSelected results={results} selectedId={selectedId} />
    </MapContainer>
  );
}
