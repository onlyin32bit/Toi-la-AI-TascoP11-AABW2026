import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Search,
  Mic,
  MapPin,
  Navigation,
  Navigation2,
  Compass,
  Layers,
  ArrowLeft,
  Car,
  Bus,
  Footprints,
  Bike,
  Scooter,
  Check,
  X,
  MoreHorizontal,
  Share2,
  Bookmark,
  Zap,
  Fuel,
  Utensils,
  SquareParking,
  Coffee,
  Map,
  Globe,
  TrafficCone,
  Square,
  Box
} from "lucide-react";
import "./App.css";

// Interface definitions for TypeScript safety
interface Place {
  id: string;
  name: string;
  address: string;
  score: number;
  tags: string[];
  lat?: number;
  lng?: number;
}

interface MenuItem {
  dish_name: string;
  menu_category: string;
  price_vnd?: number;
  is_signature?: boolean;
  dietary_tags?: string[];
}

interface Review {
  comment: string;
  rating: number;
  sentiment: string;
}

interface PlaceDetail {
  id: string;
  name: { value: string };
  address: { value: string };
  rating: { value?: number };
  review_count: { value: number };
  quality: {
    dataset_score: number;
    computed_score: number;
    gaps: string[];
  };
  menu: { value: MenuItem[] };
  reviews: { value: Review[] };
  ai_summary?: string;
  known_strengths?: { value: string[] };
}

// Fixed GPS coordinate for user's Current Location (Hanoi center near Lotte Mall)
const USER_LOCATION: [number, number] = [21.0315, 105.8115];

// Static Mock Data for 100% Frontend Independent Test
const MOCK_PLACES: Place[] = [
  {
    id: "RES002",
    name: "Sushi Sakura",
    address: "25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội",
    score: 0.90,
    tags: ["segment:Japanese", "amenity:AirConditioning", "diet:HalalFriendly"]
  },
  {
    id: "RES018",
    name: "Bún Chả Phố Cổ",
    address: "18 Đường Láng, Đống Đa, Hà Nội",
    score: 0.78,
    tags: ["segment:Vietnamese", "amenity:Parking", "amenity:OutdoorSeating"]
  },
  {
    id: "RES005",
    name: "Phở Gia Truyền",
    address: "49 Bát Đàn, Cửa Đông, Hoàn Kiếm, Hà Nội",
    score: 0.85,
    tags: ["segment:Vietnamese", "amenity:CashOnly"]
  }
];

const MOCK_PLACE_DETAILS: Record<string, PlaceDetail> = {
  "RES002": {
    id: "RES002",
    name: { value: "Sushi Sakura" },
    address: { value: "25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội" },
    rating: { value: 4.5 },
    review_count: { value: 120 },
    quality: {
      dataset_score: 0.85,
      computed_score: 0.90,
      gaps: []
    },
    menu: {
      value: [
        { dish_name: "Combo Sakura Sushi Special", menu_category: "Sushi Combo", price_vnd: 350000, is_signature: true, dietary_tags: ["Seafood"] },
        { dish_name: "Sashimi Salmon (5 chiếc)", menu_category: "Sashimi", price_vnd: 180000, is_signature: false, dietary_tags: ["Raw Seafood"] },
        { dish_name: "Tempura Udon", menu_category: "Noodles", price_vnd: 120000, is_signature: false }
      ]
    },
    reviews: {
      value: [
        { comment: "Đồ ăn rất tươi, phục vụ nhiệt tình nhanh chóng.", rating: 5, sentiment: "Tích cực" },
        { comment: "Không gian sang trọng, giá hơi cao nhưng xứng đáng.", rating: 4, sentiment: "Tích cực" }
      ]
    },
    ai_summary: "Sushi Sakura được đánh giá cao về độ tươi ngon của hải sản và không gian đậm nét văn hóa Nhật Bản. Rất thích hợp cho các buổi tiếp khách hoặc gia đình.",
    known_strengths: { value: ["Đồ tươi sống", "Không gian sang trọng", "Phục vụ tốt"] }
  },
  "RES018": {
    id: "RES018",
    name: { value: "Bún Chả Phố Cổ" },
    address: { value: "18 Đường Láng, Đống Đa, Hà Nội" },
    rating: { value: 4.2 },
    review_count: { value: 85 },
    quality: {
      dataset_score: 0.70,
      computed_score: 0.78,
      gaps: ["ocr_menu"]
    },
    menu: {
      value: [
        { dish_name: "Bún chả đặc biệt đầy đủ", menu_category: "Bún Chả", price_vnd: 60000, is_signature: true },
        { dish_name: "Nem cua bể giòn rụm", menu_category: "Món ăn kèm", price_vnd: 20000, is_signature: false }
      ]
    },
    reviews: {
      value: [
        { comment: "Nước dùng đậm đà thơm ngon, thịt nướng cháy cạnh vừa phải.", rating: 5, sentiment: "Tích cực" },
        { comment: "Quán hơi chật và nóng vào buổi trưa cao điểm.", rating: 3, sentiment: "Trung lập" }
      ]
    },
    ai_summary: "Nước dùng của quán có hương vị truyền thống đặc biệt, nem cua bể nhân đầy đặn. Điểm trừ lớn là quán hơi nhỏ và đỗ xe ô tô vào giờ cao điểm hơi khó khăn.",
    known_strengths: { value: ["Nước dùng ngon", "Nem giòn", "Giá hợp lý"] }
  },
  "RES005": {
    id: "RES005",
    name: { value: "Phở Gia Truyền" },
    address: { value: "49 Bát Đàn, Hoàn Kiếm, Hà Nội" },
    rating: { value: 4.4 },
    review_count: { value: 340 },
    quality: {
      dataset_score: 0.75,
      computed_score: 0.85,
      gaps: ["menu"]
    },
    menu: {
      value: [
        { dish_name: "Phở bò tái nạm", menu_category: "Phở", price_vnd: 55000, is_signature: true },
        { dish_name: "Quẩy giòn", menu_category: "Ăn kèm", price_vnd: 10000, is_signature: false }
      ]
    },
    reviews: {
      value: [
        { comment: "Hương vị phở chuẩn Hà Nội xưa, nước dùng thanh ngọt tự nhiên.", rating: 5, sentiment: "Tích cực" },
        { comment: "Phải xếp hàng hơi lâu mới mua được phở.", rating: 4, sentiment: "Trung lập" }
      ]
    },
    ai_summary: "Phở Bát Đàn nổi tiếng lâu đời với sợi phở mềm dai, thịt bò thái mỏng tươi ngon và nước dùng ninh xương đậm vị ngọt thanh. Phải xếp hàng tự phục vụ.",
    known_strengths: { value: ["Nước phở ngon", "Thương hiệu lâu đời"] }
  }
};

// Map POI ID to fixed offsets around Hanoi for realistic map display
const getMockCoordinates = (id: string): [number, number] => {
  const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const latOffset = ((hash % 100) - 50) * 0.0003;
  const lngOffset = (((hash >> 2) % 100) - 50) * 0.0003;
  return [USER_LOCATION[0] + latOffset, USER_LOCATION[1] + lngOffset];
};

function App() {
  // UI states: 'home' (minimized map view) | 'home_expanded' (half-sheet search/categories) | 'search_results' | 'place_details' | 'route_setup' | 'navigation' | 'min'
  const [uiState, setUiState] = useState<"home" | "home_expanded" | "search_results" | "place_details" | "route_setup" | "navigation" | "min">("home");
  
  // Data states
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetail | null>(null);

  // Map settings
  const [isSatellite, setIsSatellite] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [showMapModeSheet, setShowMapModeSheet] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const [showTransit, setShowTransit] = useState(false);

  // Navigation simulation states
  const [navRouteIndex, setNavRouteIndex] = useState<0 | 1 | 2>(0);
  const [simulatedSpeed, setSimulatedSpeed] = useState(0);
  const [navStepIndex, setNavStepIndex] = useState(0);

  // Map Leaflet Refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const poiMarkerRef = useRef<L.Marker | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);

  // Toggle bottom sheet expand/minimize states
  const toggleSheet = () => {
    if (uiState === "home") {
      setUiState("home_expanded");
    } else if (uiState === "home_expanded") {
      setUiState("home");
    } else if (uiState === "min") {
      if (selectedPlace) {
        setUiState("place_details");
      } else {
        setUiState("home");
      }
    } else {
      setUiState("min");
    }
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create Map pointing to Hanoi
    mapRef.current = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView(USER_LOCATION, 15);

    // Default Streets Tile (Light Positron)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20
    }).addTo(mapRef.current);

    // Current location marker (Blue pin with pulse rings)
    const userIcon = L.divIcon({
      html: `
        <div class="user-gps-pulse-ring"></div>
        <div style="background-color: #3b82f6; width: 16px; height: 16px; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.6); position: relative; z-index: 2;"></div>
      `,
      className: "user-gps-pin-container",
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
    userMarkerRef.current = L.marker(USER_LOCATION, { icon: userIcon }).addTo(mapRef.current);

    // Add surrounding mock markers similar to screenshot (WinMart+, Coffee shops)
    const mockPois = [
      { name: "Cà Phê Fimo Sp", coords: [21.0335, 105.8085] },
      { name: "Sakura Montessori", coords: [21.0345, 105.8135] },
      { name: "WinMart+", coords: [21.0318, 105.8118] },
      { name: "Kohi Coffee", coords: [21.0285, 105.8125] }
    ];

    mockPois.forEach(poi => {
      const poiIcon = L.divIcon({
        html: `
          <div class="map-label-poi">
            <span class="poi-label-dot"></span>
            <span class="poi-label-text">${poi.name}</span>
          </div>
        `,
        className: "custom-map-label",
        iconSize: [100, 30],
        iconAnchor: [50, 15]
      });
      L.marker(poi.coords as [number, number], { icon: poiIcon }).addTo(mapRef.current!);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update map layer base on satellite mode
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old layers
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        mapRef.current?.removeLayer(layer);
      }
    });

    const StreetsLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20
    });

    const SatelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19
    });

    if (isSatellite) {
      SatelliteLayer.addTo(mapRef.current);
    } else {
      StreetsLayer.addTo(mapRef.current);
    }
  }, [isSatellite]);

  // Handle toggling of 3D simulated tilt angle
  const handleToggle3D = () => {
    const nextState = !is3D;
    setIs3D(nextState);
    if (mapRef.current) {
      // Auto zoom in to 17 in 3D mode for detailed buildings, zoom out to 15 for 2D
      if (nextState) {
        mapRef.current.setZoom(17, { animate: true });
      } else {
        mapRef.current.setZoom(15, { animate: true });
      }
      setTimeout(() => {
        mapRef.current?.invalidateSize({ animate: true });
        mapRef.current?.panBy([0, nextState ? -80 : 80], { animate: true });
      }, 300);
    }
  };

  // Speedometer simulation in Navigation Mode
  useEffect(() => {
    let interval: number;
    if (uiState === "navigation") {
      setSimulatedSpeed(35);
      interval = window.setInterval(() => {
        setSimulatedSpeed(prev => {
          const delta = (Math.random() - 0.5) * 6;
          const next = Math.max(15, Math.min(65, prev + delta));
          return Math.round(next);
        });
        setNavStepIndex(prev => (prev + 1) % 4);
      }, 3000);
    } else {
      setSimulatedSpeed(0);
      setNavStepIndex(0);
    }
    return () => clearInterval(interval);
  }, [uiState]);

  // Submit query for search results (Mock Filter)
  const handleSearchSubmit = (queryText: string) => {
    const term = queryText.trim().toLowerCase();
    if (!term) return;
    setSearchQuery(queryText.trim());
    setUiState("search_results");

    // Filter MOCK_PLACES based on query keywords
    const filtered = MOCK_PLACES.filter(place => 
      place.name.toLowerCase().includes(term) || 
      place.address.toLowerCase().includes(term) ||
      place.tags.some(tag => tag.toLowerCase().includes(term))
    );
    
    setSearchResults(filtered);
  };

  // Display specific place details and trigger map movements
  const selectPlaceDetails = (placeId: string) => {
    const cleanId = placeId.replace("poi:", "").toUpperCase();
    const data = MOCK_PLACE_DETAILS[cleanId];
    if (!data) return;
      
    setSelectedPlace(data);
    setUiState("place_details");

    // Draw Marker on Map
    const coords = getMockCoordinates(data.id);
    if (mapRef.current) {
      if (poiMarkerRef.current) {
        mapRef.current.removeLayer(poiMarkerRef.current);
      }
      if (routePolylineRef.current) {
        mapRef.current.removeLayer(routePolylineRef.current);
      }

      const redIcon = L.divIcon({
        html: `<div style="background-color: #ef4444; width: 16px; height: 16px; border: 2.5px solid white; border-radius: 50%; box-shadow: 0 0 12px #ef4444;"></div>`,
        className: "poi-target-pin",
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      poiMarkerRef.current = L.marker(coords, { icon: redIcon }).addTo(mapRef.current);
      
      const bounds = L.latLngBounds([USER_LOCATION, coords]);
      mapRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  };

  // Setup simulated Route paths
  const handleRouteSetup = () => {
    if (!selectedPlace) return;
    setUiState("route_setup");

    // Draw routing Polyline
    if (mapRef.current) {
      if (routePolylineRef.current) {
        mapRef.current.removeLayer(routePolylineRef.current);
      }

      const destCoords = getMockCoordinates(selectedPlace.id);
      
      const pathPoints: [number, number][] = [
        USER_LOCATION,
        [USER_LOCATION[0] + (destCoords[0] - USER_LOCATION[0]) * 0.4 + 0.001, USER_LOCATION[1] + (destCoords[1] - USER_LOCATION[1]) * 0.3 - 0.0005],
        [USER_LOCATION[0] + (destCoords[0] - USER_LOCATION[0]) * 0.7 - 0.0005, USER_LOCATION[1] + (destCoords[1] - USER_LOCATION[1]) * 0.75 + 0.0008],
        destCoords
      ];

      routePolylineRef.current = L.polyline(pathPoints, {
        color: "#1d70f2",
        weight: 5,
        opacity: 0.8,
        dashArray: "10, 10"
      }).addTo(mapRef.current);

      mapRef.current.fitBounds(routePolylineRef.current.getBounds(), { padding: [30, 30] });
    }
  };

  // Launch simulated Navigation Mode
  const startNavigation = () => {
    setUiState("navigation");
    if (mapRef.current) {
      mapRef.current.setView(USER_LOCATION, 17, { animate: true });
    }
  };

  // Quit simulated Navigation
  const exitNavigation = () => {
    setUiState("home");
    if (mapRef.current) {
      if (poiMarkerRef.current) mapRef.current.removeLayer(poiMarkerRef.current);
      if (routePolylineRef.current) mapRef.current.removeLayer(routePolylineRef.current);
      mapRef.current.setView(USER_LOCATION, 15, { animate: true });
    }
    setSelectedPlace(null);
    setSearchQuery("");
  };

  const navigationSteps = [
    { instruction: "Đi thẳng theo hướng Lạc Long Quân", distance: "1.2 km" },
    { instruction: "Chuẩn bị rẽ trái vào Âu Cơ", distance: "450 m" },
    { instruction: "Rẽ trái tại ngã tư tiếp theo", distance: "150 m" },
    { instruction: "Bạn đã đến gần điểm đích bên phải", distance: "50 m" }
  ];

  return (
    <main className="app-layout">
      {/* T MAPS PHONE SIMULATOR */}
      <section className={`phone-simulator ${is3D ? "is-3d" : ""}`}>
        <div className="phone-notch">
          <div className="phone-notch-camera" />
          <div className="phone-notch-speaker" />
        </div>

        {/* Simulated iOS Status Bar */}
        <div className={`phone-status-bar ${uiState === "navigation" ? "dark-mode" : ""}`}>
          <span>23:33</span>
          <div className="phone-status-right">
            <span style={{ fontSize: "0.6rem" }}>5G</span>
            <div style={{ width: 16, height: 8, border: "1px solid currentColor", padding: 1, borderRadius: 2, display: "flex" }}>
              <div style={{ flex: 1, backgroundColor: "currentColor", borderRadius: 1 }} />
            </div>
          </div>
        </div>

        {/* Leaflet Map rendering view with simulated 3D tilt class */}
        <div className={`map-view ${is3D ? "leaflet-3d-active" : ""}`}>
          <div ref={mapContainerRef} />
        </div>

        {/* Floating map controls (Xếp dọc góc dưới bên phải như hình 2) */}
        {uiState !== "navigation" && (
          <div className={`map-controls state-${uiState}`}>
            <button className={`control-btn ${is3D ? "active" : ""}`} onClick={handleToggle3D}>
              <span style={{ fontSize: "0.75rem", fontWeight: 800 }}>3D</span>
            </button>
            <button className={`control-btn ${isSatellite ? "active" : ""}`} onClick={() => setShowMapModeSheet(true)}>
              <Layers size={18} />
            </button>
            <button className="control-btn" onClick={() => {
              if (mapRef.current) mapRef.current.setView(USER_LOCATION, 15, { animate: true });
            }}>
              <Compass size={18} />
            </button>
          </div>
        )}

        {/* Simulated Navigation Heads Up Panels */}
        {uiState === "navigation" && (
          <>
            <div className="nav-direction-panel">
              <Navigation2 size={24} style={{ transform: "rotate(-45deg)" }} />
              <div>
                <div className="nav-direction-val">{navigationSteps[navStepIndex].distance}</div>
                <div className="nav-direction-lbl">{navigationSteps[navStepIndex].instruction}</div>
              </div>
            </div>
            <div className="nav-speed-panel">
              <span className="nav-speed-val">{simulatedSpeed}</span>
              <span className="nav-speed-lbl">km/h</span>
            </div>
          </>
        )}

        {/* ==========================================================
           DYNAMIC LAYERED BOTTOM SHEET CONTROLLER
           ========================================================== */}
        <div className={`bottom-sheet state-${
          uiState === "home" ? "min" : 
          uiState === "home_expanded" ? "half" :
          uiState === "search_results" ? "full" : 
          uiState === "place_details" ? "details" : 
          uiState === "route_setup" ? "full" : "min"
        }`}>
          <div className="sheet-handle" onClick={toggleSheet} />
          
          {/* A. SEARCH BAR INTEGRATED IN BOTTOM SHEET (Hình 2) */}
          {(uiState === "home" || uiState === "home_expanded" || uiState === "search_results") && (
            <div className="inner-search-bar" onClick={() => uiState === "home" && setUiState("home_expanded")}>
              <span className="search-icon-btn" onClick={(e) => {
                e.stopPropagation();
                handleSearchSubmit(searchQuery);
              }}>
                <Search size={18} style={{ color: "#64748b" }} />
              </span>
              <input 
                type="text" 
                placeholder="Tìm kiếm" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit(searchQuery)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (uiState === "home") setUiState("home_expanded");
                }}
              />
              <Mic size={18} style={{ color: "#64748b", marginRight: "0.25rem" }} />
              <div className="avatar-btn" style={{ backgroundColor: "#f97316" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            </div>
          )}

          <div className="sheet-content">
            {/* HOME VIEW (CATEGORIES & RECENT HISTORY) */}
            {(uiState === "home" || uiState === "home_expanded") && (
              <>
                <div className="goy-section">
                  <div className="goy-left">
                    <div className="icon-circle-bg">
                      <Car size={18} />
                    </div>
                    <div>
                      <div className="goy-title">Ô tô đã đỗ</div>
                      <div className="goy-desc">Gần Keangnam Landmark 72</div>
                    </div>
                  </div>
                  <MoreHorizontal size={16} style={{ color: "#94a3b8", cursor: "pointer" }} />
                </div>

                <div className="category-grid">
                  <div className="cat-item" onClick={() => handleSearchSubmit("Trạm sạc")}>
                    <div className="cat-icon-circle cat-blue"><Zap size={18} /></div>
                    <span>Trạm sạc</span>
                  </div>
                  <div className="cat-item" onClick={() => handleSearchSubmit("Cây xăng")}>
                    <div className="cat-icon-circle cat-orange"><Fuel size={18} /></div>
                    <span>Cây xăng</span>
                  </div>
                  <div className="cat-item" onClick={() => handleSearchSubmit("Bún chả")}>
                    <div className="cat-icon-circle cat-rose"><Utensils size={18} /></div>
                    <span>Ăn uống</span>
                  </div>
                  <div className="cat-item" onClick={() => handleSearchSubmit("Bãi đỗ")}>
                    <div className="cat-icon-circle cat-navy"><SquareParking size={18} /></div>
                    <span>Bãi đỗ xe</span>
                  </div>
                  <div className="cat-item" onClick={() => handleSearchSubmit("Sakura")}>
                    <div className="cat-icon-circle cat-brown"><Coffee size={18} /></div>
                    <span>Cafe</span>
                  </div>
                </div>

                <div className="recent-header">Gần đây</div>
                <div className="history-item" onClick={() => selectPlaceDetails("RES018")}>
                  <div className="history-left">
                    <MapPin size={16} style={{ color: "#94a3b8" }} />
                    <div>
                      <div className="history-name">Bún Chả Phố Cổ</div>
                      <div className="history-address">18 Đường Láng, Hà Nội</div>
                    </div>
                  </div>
                  <MoreHorizontal size={16} style={{ color: "#94a3b8", cursor: "pointer" }} />
                </div>
              </>
            )}

            {/* B. SEARCH RESULTS VIEW */}
            {uiState === "search_results" && (
              <>
                <div className="results-header-box">
                  <button className="search-back-btn" onClick={() => setUiState("home")}>
                    <ArrowLeft size={16} /> Quay lại
                  </button>
                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Tìm thấy {searchResults.length} kết quả</span>
                </div>

                <div className="results-list">
                  {searchResults.map((place, idx) => (
                    <div key={place.id} className="result-card" onClick={() => selectPlaceDetails(place.id)}>
                      <div className="result-pin">
                        <MapPin size={16} />
                      </div>
                      <div className="result-info">
                        <div className="card-title">{place.name}</div>
                        <div className="card-address">{place.address}</div>
                      </div>
                      {idx === 0 && (
                        <button
                          className="result-route-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectPlaceDetails(place.id);
                          }}
                        >
                          Chỉ đường
                        </button>
                      )}
                    </div>
                  ))}
                  {searchResults.length === 0 && (
                    <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                      Không có kết quả nào. Thử tìm "Sakura", "Bún chả" hoặc "Phở".
                    </div>
                  )}
                </div>
              </>
            )}

            {/* C. PLACE DETAILS VIEW */}
            {uiState === "place_details" && selectedPlace && (
              <>
                <div className="details-head">
                  <div className="details-head-top">
                    <h2 className="details-name">{selectedPlace.name.value}</h2>
                    <div className="details-head-actions">
                      <button className="icon-btn-ghost" onClick={handleRouteSetup}>
                        <Navigation size={16} />
                      </button>
                      <button className="icon-btn-ghost" onClick={() => setUiState("home")}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="details-meta-row">
                    {selectedPlace.rating.value ? (
                      <>
                        <span className="details-rating">★ {selectedPlace.rating.value}</span>
                        <span style={{ color: "#94a3b8" }}>({selectedPlace.review_count.value} đánh giá)</span>
                      </>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>Chưa có đánh giá</span>
                    )}
                  </div>
                  <div className="details-sub-row">{selectedPlace.address.value}</div>
                  <div className="details-sub-row">Giờ mở cửa chưa rõ</div>
                  <div className="details-sub-row details-coords">
                    {getMockCoordinates(selectedPlace.id).map((v) => v.toFixed(6)).join(", ")}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="action-row">
                  <button className="btn-primary-action" onClick={handleRouteSetup}>
                    <Navigation size={16} />
                    Chỉ đường
                  </button>
                  <button className="btn-sec-action">
                    <Share2 size={18} />
                  </button>
                  <button className="btn-sec-action">
                    <Bookmark size={18} />
                  </button>
                </div>
              </>
            )}

            {/* D. ROUTE PLANNING VIEW */}
            {uiState === "route_setup" && selectedPlace && (
              <>
                <div className="route-top-panel">
                  <div className="route-header-row">
                    <h3>Chỉ đường</h3>
                    <button className="route-close-btn" onClick={() => setUiState("place_details")}>
                      <X size={18} />
                    </button>
                  </div>

                  <div className="vehicle-tabs">
                    <button className="vehicle-tab-btn active">
                      <Car size={18} />
                    </button>
                    <button className="vehicle-tab-btn">
                      <Bus size={18} />
                    </button>
                    <button className="vehicle-tab-btn">
                      <Footprints size={18} />
                    </button>
                    <button className="vehicle-tab-btn">
                      <Bike size={18} />
                    </button>
                    <button className="vehicle-tab-btn">
                      <Scooter size={18} />
                    </button>
                  </div>

                  <div className="route-inputs">
                    <div className="route-connector" />
                    <div className="input-node">
                      <span className="route-dot route-dot-origin" />
                      <span>Vị trí hiện tại của bạn</span>
                    </div>
                    <div className="input-node">
                      <span className="route-dot route-dot-dest" />
                      <span>{selectedPlace.name.value}</span>
                    </div>
                  </div>
                </div>

                <div className="route-detail-summary">
                  <div>
                    <div className="route-time-val">16 phút</div>
                    <div className="route-dist-val">16 km · Đến lúc 23:50</div>
                  </div>
                  <button className="btn-primary-action" style={{ padding: "0.6rem 1.2rem" }} onClick={startNavigation}>
                    Bắt đầu
                  </button>
                </div>

                <div className="recent-header">Tuyến đường khác</div>
                <div className="route-list-alt">
                  <div className={`alt-route-card ${navRouteIndex === 0 ? "active" : ""}`} onClick={() => setNavRouteIndex(0)}>
                    <div>
                      <div className="alt-route-time">16 phút</div>
                      <div className="alt-route-name">Nhanh nhất · Qua Võ Chí Công</div>
                    </div>
                    {navRouteIndex === 0 && <Check size={16} style={{ color: "#1d70f2" }} />}
                  </div>
                  <div className={`alt-route-card ${navRouteIndex === 1 ? "active" : ""}`} onClick={() => setNavRouteIndex(1)}>
                    <div>
                      <div className="alt-route-time">21 phút</div>
                      <div className="alt-route-name">Tuyến khác · Qua Đường Bưởi</div>
                    </div>
                    {navRouteIndex === 1 && <Check size={16} style={{ color: "#1d70f2" }} />}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* E. SIMULATED TURN-BY-TURN NAVIGATION FOOTER */}
        {uiState === "navigation" && (
          <div className="nav-bottom-bar">
            <div>
              <div className="nav-stats-time">16 phút</div>
              <div className="nav-stats-dist">16 km · 23:50 đến nơi</div>
            </div>
            <button className="btn-cancel-nav" onClick={exitNavigation}>
              <X size={18} />
            </button>
          </div>
        )}

        {/* F. MAP MODE PICKER SHEET */}
        {showMapModeSheet && (
          <div className="map-mode-overlay" onClick={() => setShowMapModeSheet(false)}>
            <div className="map-mode-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-handle" />
              <div className="map-mode-header">
                <h3>Chế độ bản đồ</h3>
                <button className="icon-btn-ghost" onClick={() => setShowMapModeSheet(false)}>
                  <X size={16} />
                </button>
              </div>

              <div className="map-mode-section-title">Loại bản đồ</div>
              <div className="map-mode-thumb-row">
                <button
                  className={`map-mode-thumb ${!isSatellite ? "active" : ""}`}
                  onClick={() => setIsSatellite(false)}
                >
                  <div className="thumb-preview thumb-default"><Map size={20} /></div>
                  <span>Mặc định</span>
                </button>
                <button
                  className={`map-mode-thumb ${isSatellite ? "active" : ""}`}
                  onClick={() => setIsSatellite(true)}
                >
                  <div className="thumb-preview thumb-satellite"><Globe size={20} /></div>
                  <span>Vệ tinh</span>
                </button>
              </div>

              <div className="map-mode-section-title">Chi tiết bản đồ</div>
              <div className="map-mode-thumb-row">
                <button
                  className={`map-mode-thumb ${showTraffic ? "active" : ""}`}
                  onClick={() => setShowTraffic(!showTraffic)}
                >
                  <div className="thumb-preview thumb-traffic"><TrafficCone size={20} /></div>
                  <span>Giao thông</span>
                </button>
                <button
                  className={`map-mode-thumb ${showTransit ? "active" : ""}`}
                  onClick={() => setShowTransit(!showTransit)}
                >
                  <div className="thumb-preview thumb-transit"><Bus size={20} /></div>
                  <span>Phương tiện công cộng</span>
                </button>
                <button
                  className={`map-mode-thumb ${!is3D ? "active" : ""}`}
                  onClick={() => { if (is3D) handleToggle3D(); }}
                >
                  <div className="thumb-preview thumb-2d"><Square size={20} /></div>
                  <span>2D</span>
                </button>
                <button
                  className={`map-mode-thumb ${is3D ? "active" : ""}`}
                  onClick={() => { if (!is3D) handleToggle3D(); }}
                >
                  <div className="thumb-preview thumb-3d"><Box size={20} /></div>
                  <span>3D</span>
                </button>
              </div>

              <div className="map-mode-attribution">© Esri, Maxar, Earthstar Geographics và GIS User Community</div>
            </div>
          </div>
        )}

        <div className="phone-home-indicator" />
      </section>
    </main>
  );
}

export default App;
