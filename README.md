# Kromos

Kromos es una app tipo Pinterest para guardar, subir y explorar referencias visuales.

## Stack

- Frontend: Vite + JavaScript + CSS
- Backend: Node.js + Express
- Base de datos: PostgreSQL
- Uploads locales: carpeta `uploads/`
- Logs: Pino + `pino-http`
- Contenedores: Docker Compose

## Desarrollo Local

1. Instala dependencias:

```bash
npm install
```

2. Copia variables de entorno:

```bash
cp .env.example .env
```

3. Abre Docker Desktop y levanta PostgreSQL:

```bash
docker compose up -d db
```

4. Arranca la API:

```bash
npm run dev:api
```

5. En otra terminal arranca el frontend:

```bash
npm run dev
```

Frontend:

```txt
http://127.0.0.1:5173
```

API healthcheck:

```txt
http://127.0.0.1:4000/api/health
```

## Producción Local Con Docker

Cuando Docker Desktop esté abierto:

```bash
docker compose up --build
```

La app completa queda en:

```txt
http://localhost:4000
```

## Arquitectura

El frontend consume `/api/pins`. En desarrollo Vite redirige `/api` y `/uploads` al backend con proxy.

El backend:

- Crea tablas automáticamente al arrancar.
- Si la base está vacía, inserta pins iniciales.
- Maneja registro, login y logout con cookie HTTP-only.
- Guarda contraseñas con hash, no en texto plano.
- Guarda likes y tableros por usuario.
- Guarda imágenes subidas en `uploads/`.
- Guarda metadatos, likes y guardados en PostgreSQL.
- Expone un healthcheck para monitoreo.

## Siguiente Paso Recomendado

Para llevarlo a producción real:

- Cambiar uploads locales por S3, Cloudflare R2 o MinIO.
- Agregar tests de API.
- Agregar migraciones versionadas.
- Cambiar `JWT_SECRET` por un secreto fuerte.
- Activar `COOKIE_SECURE=true` cuando esté detrás de HTTPS.
