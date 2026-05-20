import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { config } from './config.js';
import { migrate, pool, seedPins } from './db.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const uploadPath = path.resolve(projectRoot, config.uploadDir);
const app = express();
const authCookie = 'kromos_session';

const authSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  email: z.string().trim().email().max(160).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(120)
});

const pinSchema = z.object({
  title: z.string().trim().min(1).max(90),
  author: z.string().trim().max(60).optional(),
  category: z.enum(['Fotografía', 'Diseño UI', 'Arte Digital', 'Arquitectura', 'Mis subidas']),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  municipio: z.string().trim().max(100).optional()
});

const reactionSchema = z.object({
  liked: z.boolean().optional(),
  saved: z.boolean().optional()
});

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, uploadPath),
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    callback(null, `${randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
    const ext = path.extname(file.originalname).toLowerCase();

    if (!file.mimetype.startsWith('image/') && !allowedExtensions.has(ext)) {
      callback(new Error('Solo se permiten archivos de imagen.'));
      return;
    }

    callback(null, true);
  }
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

const allowedOrigins = new Set([
  config.corsOrigin,
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5174'
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origen no permitido por CORS.'));
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use('/uploads', express.static(uploadPath));


app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, service: 'kromos-api', database: 'up' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', async (request, response, next) => {
  try {
    const input = authSchema.required({ name: true }).parse(request.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      passwordHash,
      avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(input.name)}`
    };

    const { rows } = await pool.query(
      `INSERT INTO users (id, name, email, password_hash, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, avatar_url, created_at`,
      [user.id, user.name, user.email, user.passwordHash, user.avatarUrl]
    );

    setSessionCookie(response, rows[0].id);
    response.status(201).json({ user: toUser(rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Ese correo ya está registrado.' });
      return;
    }

    next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const input = authSchema.omit({ name: true }).parse(request.body);
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, avatar_url, created_at FROM users WHERE email = $1',
      [input.email]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      response.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }

    setSessionCookie(response, user.id);
    response.json({ user: toUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie(authCookie, cookieOptions());
  response.status(204).send();
});

app.get('/api/auth/me', async (request, response) => {
  response.json({ user: request.user ? toUser(request.user) : null });
});

app.patch('/api/users/me/avatar', requireUser, upload.single('avatar'), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'La nueva foto de perfil es obligatoria.' });
      return;
    }

    const avatarUrl = `/uploads/${request.file.filename}`;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE users
         SET avatar_url = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email, avatar_url, created_at`,
        [avatarUrl, request.user.id]
      );

      await client.query(
        `UPDATE pins
         SET avatar_url = $1, updated_at = NOW()
         WHERE owner_id = $2`,
        [avatarUrl, request.user.id]
      );

      await client.query('COMMIT');
      response.json({ user: toUser(rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/pins', async (request, response, next) => {
  try {
    const query = String(request.query.query || '').trim();
    const category = String(request.query.category || 'Todos');
    const view = String(request.query.view || 'all');
    const where = [];
    const params = [];
    const userId = request.user?.id || null;

    if (view === 'liked') where.push('COALESCE(pr.liked, FALSE) = TRUE');
    if (view === 'saved') where.push('COALESCE(pr.saved, FALSE) = TRUE');
    if (view === 'explore') where.push('p.is_local = FALSE');
    if (view === 'mine') {
      if (!userId) {
        response.json({ pins: [] });
        return;
      }

      params.push(userId);
      where.push(`p.owner_id = $${params.length}`);
    }

    if (category === 'Mis subidas') {
      if (!userId) {
        response.json({ pins: [] });
        return;
      }

      params.push(userId);
      where.push(`p.owner_id = $${params.length}`);
    } else if (category !== 'Todos') {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }

    if (query) {
      params.push(`%${query.toLowerCase()}%`);
      where.push(`(LOWER(p.title) LIKE $${params.length} OR LOWER(p.author) LIKE $${params.length} OR LOWER(p.category) LIKE $${params.length})`);
    }

    params.push(userId);
    const reactionUserParam = params.length;

    const sql = `
      SELECT p.id, p.owner_id, p.title, p.author, p.category, p.image_url, p.avatar_url,
       p.latitude, p.longitude, p.municipio,
       COALESCE(pr.liked, FALSE) AS liked,
       COALESCE(pr.saved, FALSE) AS saved,
       p.is_local, p.created_at
      FROM pins p
      LEFT JOIN pin_reactions pr ON pr.pin_id = p.id AND pr.user_id = $${reactionUserParam}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.created_at DESC
    `;

    const { rows } = await pool.query(sql, params);
    response.json({ pins: rows.map((row) => toPin(row, userId)) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/pins', requireUser, upload.single('image'), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'La imagen es obligatoria.' });
      return;
    }

    const input = pinSchema.parse(request.body);
    const id = randomUUID();
    const imageUrl = `/uploads/${request.file.filename}`;

    const { rows } = await pool.query(
      `INSERT INTO pins (id, owner_id, title, author, category, image_url, avatar_url, is_local, latitude, longitude, municipio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10)
       RETURNING id, owner_id, title, author, category, image_url, avatar_url, FALSE AS liked, FALSE AS saved, is_local, latitude, longitude, municipio, created_at`,
      [id, request.user.id, input.title, input.author || request.user.name, input.category, imageUrl, request.user.avatar_url, input.latitude || null, input.longitude || null, input.municipio || null]
    );

    response.status(201).json({ pin: toPin(rows[0], request.user.id) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/pins/:id/reactions', requireUser, async (request, response, next) => {
  try {
    const input = reactionSchema.parse(request.body);
    const liked = typeof input.liked === 'boolean' ? input.liked : false;
    const saved = typeof input.saved === 'boolean' ? input.saved : false;

    const { rowCount } = await pool.query('SELECT 1 FROM pins WHERE id = $1', [request.params.id]);
    if (!rowCount) {
      response.status(404).json({ error: 'Pin no encontrado.' });
      return;
    }

    await pool.query(
      `INSERT INTO pin_reactions (user_id, pin_id, liked, saved)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, pin_id)
       DO UPDATE SET
         liked = CASE WHEN $5 THEN EXCLUDED.liked ELSE pin_reactions.liked END,
         saved = CASE WHEN $6 THEN EXCLUDED.saved ELSE pin_reactions.saved END,
         updated_at = NOW()`,
      [
        request.user.id,
        request.params.id,
        liked,
        saved,
        typeof input.liked === 'boolean',
        typeof input.saved === 'boolean'
      ]
    );

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/pins/:id', requireUser, async (request, response, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM pins WHERE id = $1 AND owner_id = $2',
      [request.params.id, request.user.id]
    );

    if (!rowCount) {
      response.status(404).json({ error: 'Pin tuyo no encontrado.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.resolve(projectRoot, 'dist')));
app.use(attachUser);
app.get(/.*/, (_request, response) => {
  response.sendFile(path.resolve(projectRoot, 'dist', 'index.html'));
});

app.use((error, request, response, _next) => {
  const requestLogger = request.log || logger;
  requestLogger.error({ error }, 'request failed');

  if (error instanceof z.ZodError) {
    response.status(400).json({ error: 'Datos inválidos.', details: error.issues });
    return;
  }

  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: error.message || 'Error interno del servidor.' });
});

async function attachUser(request, _response, next) {
  const token = request.cookies?.[authCookie];
  if (!token) {
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await pool.query(
      'SELECT id, name, email, avatar_url, created_at FROM users WHERE id = $1',
      [payload.sub]
    );
    request.user = rows[0] || null;
  } catch {
    request.user = null;
  }

  next();
}

function requireUser(request, response, next) {
  if (!request.user) {
    response.status(401).json({ error: 'Necesitas iniciar sesión.' });
    return;
  }

  next();
}

function setSessionCookie(response, userId) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
  response.cookie(authCookie, token, cookieOptions());
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  };
}

function toPin(row, userId) {
  return {
    id: row.id,
    url: row.image_url,
    title: row.title,
    author: row.author,
    avatar: row.avatar_url,
    category: row.category,
    liked: row.liked,
    saved: row.saved,
    local: Boolean(userId && row.owner_id === userId),
    latitude: row.latitude,
    longitude: row.longitude,
    municipio: row.municipio,
    createdAt: row.created_at
  };
}

function toUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar_url,
    createdAt: row.created_at
  };
}

async function start() {
  await mkdir(uploadPath, { recursive: true });
  await migrate();
  await seedPins();

  app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'kromos api listening');
  });
}

start().catch((error) => {
  logger.fatal({ error }, 'failed to start server');
  process.exit(1);
});
  