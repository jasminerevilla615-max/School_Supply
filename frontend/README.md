# Staff dashboard

React and Vite provide the development UI. Flask provides the API and serves the production build.

## Development

From the repository root, install the Python dependency and start Flask:

```powershell
python -m pip install -r requirements.txt
python -m flask --app backend.app run --debug
```

In another terminal, start Vite:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

The Vite server proxies `/api` requests to Flask at `http://127.0.0.1:5000`.

The API base URL is read from `VITE_API_BASE_URL` in the frontend environment. Copy `.env.example` to `.env` for local development; `/api` keeps requests on Vite's proxy. For a separately deployed frontend, set `VITE_API_BASE_URL` to the backend's full API URL (for example, `https://api.example.com/api`) in the frontend hosting provider before building. Vite embeds this value in the built assets, so changing it requires a new frontend build.

## Production

```powershell
cd frontend
npm.cmd run build
cd ..
python -m flask --app backend.app run
```

Flask then serves the built dashboard and the `/api/health` and `/api/products` endpoints.
When hosting frontend and backend separately, configure the backend's `CORS_ORIGINS` and session-cookie settings as described in the backend README.

## Product photos

Catalog photos are stored locally in `public/product-images/` and served from `/product-images/<filename>`. Admins can upload or replace a product photo using JPG/JPEG, PNG, or WEBP files up to 5 MB; new products require a photo. The backend validates the file extension, MIME type, size, and image signature before saving it. Source IDs and licensing notes for the current representative stock photographs are listed in [PRODUCT_PHOTO_SOURCES.md](./PRODUCT_PHOTO_SOURCES.md). Replace any photo that does not match the exact product or variant with an authentic product photo.
