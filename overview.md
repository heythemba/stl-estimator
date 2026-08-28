# Replica Cost Estimator - Project Overview & Navigation Guide

Welcome to the **Replica Cost Estimator**! This document provides a high-level overview of the entire codebase, its architecture, and step-by-step navigation instructions to help developers and AI agents quickly locate and edit any part of the system.

---

## 1. Architecture Summary

The **Replica Cost Estimator** is a complete 3D printing volume scanning and cost calculation platform designed for [Replica 3D Fabrication](https://stl-estimator.up.railway.app/).

The application consists of:
1. **FastAPI Backend (`backend/`)**: Provides REST API endpoints for public estimation, developer self-service portal, API key generation, Super Admin management, STL volume scanning, and itemized cost calculations.
2. **Mathematical Estimation Engine (`backend/estimator.py`)**: Parses 3D STL files using `trimesh` and `numpy`, calculates watertight geometry, estimates print time via machine time brackets, and computes pricing models.
3. **Multi-Tenant Data Layer (`backend/database.py`)**: Uses SQLAlchemy ORM to manage global defaults alongside custom developer user overrides (custom materials, custom machines, and custom electricity/labor rates).
4. **Vanilla Frontend SPA (`frontend/`)**: Modern dark glassmorphism user interface featuring an instant public estimation widget, a real-time Three.js 3D STL model previewer, a developer portal with API key management, and a password-protected Super Admin dashboard.
5. **Multi-Platform Deployment Support**: Ready for deployment on **Vercel** (`pyproject.toml`), **Railway / Heroku** (`Procfile`), or self-hosted via `run.py`.

---

## 2. Directory Structure

```
stl-estimator/
├── backend/
│   ├── database.py         # SQLAlchemy ORM models, migrations, DB connection, seeding
│   ├── estimator.py        # 3D STL parsing (Trimesh), public bounds formula, admin slicer costing
│   └── main.py             # FastAPI application router, auth, rate limiting, and all endpoints
├── frontend/
│   ├── app.js              # Client logic, state management, Three.js 3D viewport, API integration
│   ├── index.html          # SPA markup: Public Estimator, Developer Portal, Admin Dashboard
│   ├── reset-password.html # Password reset interface
│   ├── style.css           # CSS custom properties, glassmorphism design system, responsive styles
│   └── icon/               # Brand assets and icons
├── pyproject.toml          # Vercel entrypoint configuration and Python packaging
├── requirements.txt        # Python dependency manifest
├── Procfile                # Heroku / Railway web process entrypoint
├── run.py                  # Local Python bootstrapper & virtualenv launcher
├── migrate_db.py           # SQLite database migration helper
├── AGENTS.md               # AI Agent & Developer fast-track navigation guide
├── ARCHITECTURE.md         # Deep technical architecture and costing formulas
└── overview.md             # This document
```

---

## 3. Backend Module Breakdown (`backend/`)

### 3.1 `main.py` — The API Router & Application Controller
- **FastAPI Setup & CORS**: Configures the FastAPI app, middleware, and CORS origins.
- **Rate Limiting**: Throttles public STL uploads by IP using `upload_tracker` with cooldown times.
- **Authentication**:
  - Developer accounts: Registration, PBKDF2 password hashing, email verification (Resend API), session tokens, password reset flows.
  - API Keys: API Key validation middleware (`X-API-Key` or `?api_key=`) for programmatic access.
  - Super Admin: Passcode-protected session tokens with 4-hour inactivity timeout.
- **Endpoints**:
  - `/api/estimate/scan` — Quick STL geometry scanning (volume, surface area, watertight flag).
  - `/api/estimate/public` — Public estimation with automatic machine selection and price bounds.
  - `/api/estimate/admin` — Precise calculation factoring labor, wear & tear, preparation, and electricity.
  - `/api/settings` — Global configuration, materials, machines, and time brackets.
  - `/api/developer/*` — Developer API keys, custom materials/machines/settings, and upload logs.
  - `/api/admin/*` — Platform-wide user management, API keys, global settings, and STL file downloads/deletions.

### 3.2 `estimator.py` — The 3D Engine & Mathematical Cost Calculator
- **`parse_stl_volume(file_bytes)`**: Reads binary STL bytes into `trimesh.load()`. Calculates volume in $cm^3$, surface area in $cm^2$, watertight status, and fallback convex hull volume for non-watertight meshes.
- **`calculate_public_estimate(db, volume_cm3, material_id, infill, user_id)`**:
  1. Computes estimated part weight using material density, infill %, and support buffer.
  2. Auto-selects appropriate machine based on material enclosure requirements (e.g. ABS requires enclosed printer).
  3. Interpolates print time using machine `TimeBracket` records.
  4. Computes direct material cost + electricity cost + wear & tear overhead.
  5. Calculates selling price with margin % and tax %, applying min/max confidence bounds.
- **`calculate_admin_cost(db, weight_g, print_time_mins, material_id, machine_id, labor_hours, prep_type, prep_hours, user_id)`**:
  - Uses exact slicer metrics to calculate an itemized cost breakdown (material, electricity, wear & tear, labor setup, CAD modeling / 3D scanning preparation, margin, VAT, and total selling price).

### 3.3 `database.py` — The Data & Persistence Layer
- **Engine & Session**: Handles PostgreSQL (via `DATABASE_URL`) or local SQLite (`replica_estimator_v4.db`) with automatic `/tmp` fallback for serverless environments.
- **ORM Models**:
  - `User`: Developer accounts with email verification and password reset tokens.
  - `UserSession`: Active developer authentication sessions.
  - `ApiKey`: Developer and platform API keys with usage call counters.
  - `StlUpload`: Historical log of uploaded STL files with volume, weight, and pricing records.
  - `Material` / `UserMaterial`: Materials (PLA, PETG, ABS, etc.) with densities ($g/cm^3$) and cost/kg.
  - `Machine` / `UserMachine`: 3D printers with power wattage ($W$), flat premiums, and enclosure flags.
  - `TimeBracket`: Machine printing time estimation brackets (base time + minutes per gram).
  - `GlobalSetting` / `UserSetting`: Configurable pricing factors (electricity rate, wear & tear %, profit margin %, labor rates, tax %).
  - `AdminSession`: Super Admin active sessions.
- **`seed_database()`**: Performs auto-migration of missing columns and seeds initial configuration.

---

## 4. Frontend Map (`frontend/`)

- **`index.html`**: Layout containing:
  - Header with branding, navigation tabs, and developer login/profile dropdown.
  - Public Estimator Tab: Drag-and-drop STL upload box, 3D WebGL preview viewport, material selector, infill slider, instant price range card, and parameter breakdown.
  - Slicer / Admin Calculator Tab: Inputs for exact slicer weight, print time, machine, material, and labor. Real-time cost breakdown table.
  - Developer Portal: Account dashboard with API key generation, custom materials/machines manager, custom pricing sliders, and upload history table.
  - Super Admin Dashboard: Platform management, user list, key management, global pricing settings, and bulk upload manager.
- **`app.js`**:
  - DOM event listeners and navigation controller.
  - Three.js integration (`initThreeJS`, `loadSTLModel`, `resizeThreeJS`) for interactive 3D model rotation and viewing.
  - Asynchronous API communication for all estimate, auth, settings, and upload actions.
- **`style.css`**: Complete responsive stylesheet using CSS custom properties, glassmorphism cards, sleek gradients, tables, and modal animations.
- **`reset-password.html`**: Dedicated password reset interface handling token verification and new password submission.

---

## 5. Quick Navigation by Common Tasks

| What do you want to change? | Where to look |
|---|---|
| Change how public price ranges are calculated | `backend/estimator.py` -> `calculate_public_estimate()` |
| Change the exact slicer cost calculation | `backend/estimator.py` -> `calculate_admin_cost()` |
| Modify STL parsing, volume calculation, or 3D mesh repair | `backend/estimator.py` -> `parse_stl_volume()` |
| Add new API routes or change existing parameters | `backend/main.py` |
| Add a new setting to the admin or developer dashboard | 1. `backend/database.py` (Model & Seeding)<br>2. `backend/main.py` (`/api/settings` or `/api/developer/settings`)<br>3. `frontend/index.html` & `frontend/app.js` |
| Adjust public upload rate limits or cooldowns | `backend/main.py` -> `scan_stl_file()` & `public_estimate()` |
| Change 3D preview canvas rendering or lighting | `frontend/app.js` -> `initThreeJS()` & `loadSTLModel()` |
| Change UI colors, themes, or layout spacing | `frontend/style.css` |
| Configure Vercel deployment | `pyproject.toml` (`[tool.vercel] entrypoint = "backend.main:app"`) |

---

## 6. How to Run Locally

### Using the Bootstrapper (Recommended)
```bash
python run.py
```
This automatically creates the virtual environment, installs dependencies from `requirements.txt`, and boots the server at `http://localhost:8000`.

### Manual Launch
```bash
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
