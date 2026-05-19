import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://kromos:kromos@127.0.0.1:55432/kromos',
  jwtSecret: process.env.JWT_SECRET || 'dev-change-me-kromos-secret',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  corsOrigin: process.env.CORS_ORIGIN || 'http://127.0.0.1:5173',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 8)
};
