# Assumptions

- The existing `api/` project is the deployment unit. Domain modules are separated under `src/` without adding monorepo package publishing overhead for the MVP.
- D1 is canonical. Search documents and Vectorize vectors are derived and can be rebuilt.
- Tasco `RES...` identifiers are external IDs. Public identifiers use prefixed, time-sortable IDs.
- The supplied POI/menu/review CSV files are authorized dataset inputs and are imported through protected APIs.
- AI and Vectorize are opt-in locally through `ENABLE_AI_SEARCH=true`; D1 token retrieval keeps search functional without remote models.
- `@cf/baai/bge-m3` dimensions are not hardcoded. Indexing compares generated dimensions with `Vectorize.describe()` before mutation.
- Image/PDF/video uploads are accepted, hashed, stored, queued, and inspectable. They remain `needs_review` until a concrete OCR/video provider is configured. JSON menu-extraction artifacts and plain OCR text are processed end to end today.
- Worker runtime code cannot perform a portable DNS resolution before `fetch`. URL ingestion blocks private IP literals, unsafe ports/schemes, credentials, and revalidates redirects. Production deployment should additionally enforce DNS/IP policy at an egress gateway if arbitrary-domain submissions are enabled.
- Opening-hour strings from the supplied Tasco fixture apply to every day because the fixture provides one range rather than per-day data.
- Explicit API filters override deterministic query parsing. Uncertain natural-language constraints remain semantic preferences.
- Dietary hard filters accept only `verified` or `explicit`; inferred labels never satisfy strict requirements.
- Assistant text is deterministic and retrieval-grounded in the MVP. A generation model can replace the renderer behind the same context/citation boundary.
