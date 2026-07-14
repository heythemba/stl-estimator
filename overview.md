# Replica Cost Estimator - Project Overview

Welcome to the **Replica Cost Estimator**! This document serves as a high-level map of the codebase to help developers quickly locate the code they need to edit.

## Architecture Summary
This project is a web-based 3D printing cost estimation tool. It features a standalone frontend (HTML/JS/CSS) that interacts with a Python backend powered by FastAPI. Data is persisted using an SQLite database via SQLAlchemy.

---

## 1. Directory Structure

- `frontend/` - Contains all client-side code (UI, interactions, API calls).
- `backend/` - Contains all server-side logic (API endpoints, calculations, DB).
- `run.py` - The entry point script that bootstraps the environment and starts the backend.
- `migrate_db.py` - Database migration utilities.
- `uploads/` - (Generated) Directory where uploaded STL files are temporarily/permanently stored.

---

## 2. Backend Map (`backend/`)

The backend is built with **FastAPI** and uses **SQLAlchemy** for database interactions.

- **`main.py` (The API Router)**
  - This is the core of the backend. It defines all API routes (`/api/estimate/*`, `/api/auth/*`, `/api/settings/*`).
  - Contains rate-limiting logic, user/admin authentication middleware, and session management.
  - **Edit here to**: Add new endpoints, change rate limits, or adjust authentication rules.

- **`estimator.py` (The Core Logic Engine)**
  - Contains all the math for parsing 3D models and calculating costs.
  - **Key Functions**:
    - `parse_stl_volume()`: Uses `trimesh` to extract volume and surface area.
    - `calculate_public_estimate()`: Auto-selects machines and calculates price bounds for the public-facing widget.
    - `calculate_admin_cost()`: Precise itemized cost calculation (electricity, wear & tear, labor) for internal use.
  - **Edit here to**: Change how prices are calculated, modify infill assumptions, or tweak machine selection logic.

- **`database.py` (The Data Layer)**
  - Defines all SQLAlchemy ORM models (`User`, `Material`, `Machine`, `GlobalSetting`, etc.).
  - Handles database connection initialization and seeding default data.
  - **Edit here to**: Add new tables, modify existing database schemas, or change default seeded values.

---

## 3. Frontend Map (`frontend/`)

The frontend is vanilla HTML/JS/CSS, designed to be lightweight and fast.

- **`index.html` (The UI Structure)**
  - Contains the layout for both the Public Calculator and the Developer/Admin Dashboard.
  - Uses modals and sections hidden/shown via CSS classes.
  - **Edit here to**: Change text, add new buttons, or restructure the page layout.

- **`app.js` (The Client Logic)**
  - Handles all user interactions, file uploading, and API communication.
  - Manages UI state (e.g., switching between public view and dashboard).
  - Renders charts (using Chart.js if integrated) and updates price displays dynamically.
  - **Edit here to**: Change API request payloads, handle new responses, or modify form validations.

- **`style.css` (The Theming)**
  - Contains all custom styling.
  - **Edit here to**: Change colors, layout dimensions, or animations.

- **`reset-password.html`**
  - Dedicated page for handling password reset flows.

---

## 4. How to Navigate for Common Tasks

### Task: "I want to change how the final price is calculated."
1. Go to `backend/estimator.py`.
2. Look at `calculate_public_estimate()` (for public facing bounds) or `calculate_admin_cost()` (for exact dashboard breakdown).

### Task: "I want to add a new setting to the admin dashboard."
1. **Database**: Add the default key in `backend/database.py` (inside `seed_database`).
2. **Backend API**: Ensure `GET /api/settings` and `PUT /api/settings` in `backend/main.py` handle the new setting.
3. **Frontend UI**: Add the input field in `frontend/index.html` and wire it up in the `fetchSettings` / `saveSettings` functions within `frontend/app.js`.

### Task: "I want to change the public upload cooldown."
1. Go to `backend/main.py`.
2. Look at the `/api/estimate/scan` and `/api/estimate/public` endpoints where `upload_limit_count` and `upload_cooldown_seconds` are enforced.
