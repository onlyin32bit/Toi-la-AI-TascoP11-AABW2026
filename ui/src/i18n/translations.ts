// Lightweight i18n dictionaries (no external dependency). Flat keys, `{name}`
// interpolation handled by LanguageContext's t(). Only UI chrome is translated
// — restaurant names, addresses, dish names and reviews are real dataset
// values and stay in their original Vietnamese.
export type Lang = "vi" | "en";

type Dict = Record<string, string>;

const vi: Dict = {
  "app.subtitle": "Tìm nhà hàng theo món, sở thích và vị trí",

  "search.placeholder": "Tìm món, quán, hoặc thành phố…",
  "search.noGps": "Không có GPS?",
  "search.selectCity": "Chọn thành phố",
  "search.locate": "Dùng vị trí của tôi",
  "search.submit": "Tìm kiếm",

  "segment.family": "Gia đình",
  "segment.romantic": "Hẹn hò",
  "segment.group": "Nhóm bạn",
  "segment.fastfood": "Ăn nhanh",
  "segment.business": "Công tác",

  "diet.vegetarian": "Ăn chay",
  "diet.halal": "Halal",

  "price.budget": "Bình dân",
  "price.mid": "Trung bình",
  "price.premium": "Cao cấp",

  "time.now": "Giờ hiện tại",
  "time.lateNight": "Ăn khuya",

  "vehicle.label": "Phương tiện",
  "vehicle.walk": "Đi bộ",
  "vehicle.bike": "Xe đạp",
  "vehicle.motorbike": "Xe máy",
  "vehicle.car": "Ô tô",

  "results.count": "{count} nhà hàng",

  "why.toggle": "Vì sao gợi ý?",
  "why.semantic": "Khớp tìm kiếm",
  "why.geoDecay": "Gần vị trí bạn",
  "why.quality": "Chất lượng POI",
  "why.persona": "Khớp sở thích",
  "why.ratingPop": "Đánh giá & độ phổ biến",
  "why.localness": "Quán địa phương bình dân",
  "why.luxuryPenalty": "Trừ điểm cao cấp",
  "why.final": "Điểm cuối",
  "result.matchedDishes": "Món khớp:",
  "result.eta": "ETA",

  "reason.away": "Cách bạn {km}km",
  "reason.goodFor": "phù hợp {seg}",
  "reason.price": "giá {price}",
  "reason.openUntil": "mở tới {time}",
  "reason.overnight": "mở xuyên đêm",
  "reason.eta": "khoảng {min} phút bằng {vehicle}",

  "assistant.title": "Trợ lý AI",
  "assistant.soon": "Trung thực • Không bịa",
  "assistant.placeholder": "Hỏi về quán, món ăn…",
  "assistant.send": "Gửi",
  "assistant.notFound": 'Không tìm thấy "{name}" trong dữ liệu.',
  "assistant.honesty.note": "Tôi chỉ trả lời từ dữ liệu đã có — không bịa đặt.",

  "empty.prefix": "Không tìm thấy kết quả",
  "empty.suffix": "Thử bỏ bớt bộ lọc, ví dụ đổi thành phố hoặc mức giá.",
  "empty.reason.dish": 'không quán nào trong danh sách có "{dish}"',
  "empty.reason.dietCity": "không có quán {diet} tại {city}",
  "empty.reason.segment": "không có quán phù hợp {segment} với các bộ lọc hiện tại",
  "empty.reason.vehicleRange": "không có quán nào trong tầm {vehicle}",
  "empty.reason.generic": "không có quán nào khớp với các bộ lọc hiện tại",

  "map.score": "Điểm",

  "enrich.button": "Làm giàu dữ liệu",
  "enrich.tooltip": "Tự động điền thông tin còn thiếu",
  "quality.label": "CHẤT LƯỢNG",
  "demo.reset": "Reset demo",

  "field.menu": "Thực đơn",
  "field.hours": "Giờ mở cửa",
  "field.priceRange": "Khoảng giá",
  "field.dietTags": "Nhãn ăn kiêng",

  "ugc.chip": "Thêm quán này vào bản đồ",
  "ugc.modal.title": "Đóng góp quán ăn mới",
  "ugc.field.name": "Tên quán",
  "ugc.field.address": "Địa chỉ",
  "ugc.field.address.placeholder": "Bỏ trống để dùng vị trí hiện tại",
  "ugc.field.dish": "Món nổi bật",
  "ugc.field.dietTags": "Nhãn ăn kiêng",
  "ugc.submit": "Gửi đóng góp",
  "ugc.cancel": "Hủy",
  "ugc.pending.badge": "Chờ xác thực",
};

const en: Dict = {
  "app.subtitle": "Find restaurants by dish, preference, and location",

  "search.placeholder": "Search dishes, places, or cities…",
  "search.noGps": "No GPS?",
  "search.selectCity": "Select a city",
  "search.locate": "Use my location",
  "search.submit": "Search",

  "segment.family": "Family",
  "segment.romantic": "Date",
  "segment.group": "Groups",
  "segment.fastfood": "Fast food",
  "segment.business": "Business",

  "diet.vegetarian": "Vegetarian",
  "diet.halal": "Halal",

  "price.budget": "Budget",
  "price.mid": "Mid-range",
  "price.premium": "Premium",

  "time.now": "Open now",
  "time.lateNight": "Late night",

  "vehicle.label": "Travel by",
  "vehicle.walk": "Walk",
  "vehicle.bike": "Bike",
  "vehicle.motorbike": "Motorbike",
  "vehicle.car": "Car",

  "results.count": "{count} restaurants",

  "why.toggle": "Why recommended?",
  "why.semantic": "Search match",
  "why.geoDecay": "Near you",
  "why.quality": "POI quality",
  "why.persona": "Preference match",
  "why.ratingPop": "Rating & popularity",
  "why.localness": "Local budget eatery",
  "why.luxuryPenalty": "Premium penalty",
  "why.final": "Final score",
  "result.matchedDishes": "Matched:",
  "result.eta": "ETA",

  "reason.away": "{km} km away",
  "reason.goodFor": "good for {seg}",
  "reason.price": "{price} price",
  "reason.openUntil": "open until {time}",
  "reason.overnight": "open overnight",
  "reason.eta": "~{min} min by {vehicle}",

  "assistant.title": "AI Assistant",
  "assistant.soon": "Honest • No hallucination",
  "assistant.placeholder": "Ask about places, dishes…",
  "assistant.send": "Send",
  "assistant.notFound": '"{name}" not found in the dataset.',
  "assistant.honesty.note": "I only answer from real data — I do not make things up.",

  "empty.prefix": "No results found",
  "empty.suffix": "Try removing some filters, e.g. change the city or price.",
  "empty.reason.dish": 'no restaurant in the list has "{dish}"',
  "empty.reason.dietCity": "no {diet} restaurant in {city}",
  "empty.reason.segment": "no restaurant matches {segment} with the current filters",
  "empty.reason.vehicleRange": "no places within {vehicle} range",
  "empty.reason.generic": "no restaurant matches the current filters",

  "map.score": "Score",

  "enrich.button": "Enrich data",
  "enrich.tooltip": "Auto-fill missing info",
  "quality.label": "QUALITY",
  "demo.reset": "Reset demo",

  "field.menu": "Menu",
  "field.hours": "Open hours",
  "field.priceRange": "Price range",
  "field.dietTags": "Diet tags",

  "ugc.chip": "Add this place to map",
  "ugc.modal.title": "Contribute a new place",
  "ugc.field.name": "Name",
  "ugc.field.address": "Address",
  "ugc.field.address.placeholder": "Leave blank to use current location",
  "ugc.field.dish": "Signature dish",
  "ugc.field.dietTags": "Diet tags",
  "ugc.submit": "Submit",
  "ugc.cancel": "Cancel",
  "ugc.pending.badge": "Pending",
};

export const translations: Record<Lang, Dict> = { vi, en };
