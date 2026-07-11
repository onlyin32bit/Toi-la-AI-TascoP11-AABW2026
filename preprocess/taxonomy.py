"""VN text normalization + taxonomy maps shared by preprocess scripts (PLAN.md §5.1)."""
import re
import unicodedata

AMENITY_MAP = {
    "Bãi đỗ xe": "parking",
    "Phù hợp trẻ em": "kid_friendly",
    "Có ghế trẻ em": "baby_chair",
    "Máy lạnh": "air_con",
    "Wi-Fi miễn phí": "wifi",
    "View đẹp": "nice_view",
    "Mở cửa khuya": "late_night",
    "Đặt bàn trước": "reservation",
    "Giao hàng": "delivery",
    "Phòng riêng": "private_room",
    "Không gian ngoài trời": "outdoor",
    "Thanh toán thẻ": "card",
    "Nhạc nhẹ": "music",
}

SEGMENT_MAP = {
    "Gia đình": "family",
    "Hẹn hò": "romantic",
    "Ăn nhanh": "fastfood",
    "Du lịch": "travel",
    "Tiết kiệm": "budget",
    "Cao cấp": "premium",
    "Công tác": "business",
    "Nhóm bạn": "group",
    "Ăn chay": "vegetarian",
}

PRICE_MAP = {"Bình dân": "budget", "Trung bình": "mid", "Cao cấp": "premium"}

SENTIMENT_MAP = {"Tích cực": "pos", "Trung lập": "neu", "Tiêu cực": "neg"}

DIET_TAG_MAP = {"chay": "vegetarian", "halal": "halal", "gluten-free": "gluten_free"}


def strip_diacritics(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def norm(text: str) -> str:
    """Bỏ dấu + lowercase, dùng chung cho tên quán/món (khớp kb.go norm() §5.2)."""
    return strip_diacritics(text).lower().strip()


def tokenize(text: str) -> list[str]:
    normalized = norm(text)
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    return [t for t in normalized.split() if t]


def split_csv_field(raw: str) -> list[str]:
    """Split a comma-separated CSV cell, stripping whitespace, dropping empties."""
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]
