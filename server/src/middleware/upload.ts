import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { TMP_DIR, PREVIEWS_DIR, AVATARS_DIR, ensureDataDirs } from '../config/paths.js';

ensureDataDirs();

// Allow-listed extensions for the app content (html or zip archive).
const CONTENT_EXTS = new Set(['.html', '.htm', '.zip']);
// Allow-listed extensions for preview images.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

function randomName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return `${crypto.randomBytes(16).toString('hex')}${ext}`;
}

const storage = multer.diskStorage({
  destination(_req, file, cb) {
    cb(null, file.fieldname === 'preview' ? PREVIEWS_DIR : TMP_DIR);
  },
  filename(_req, file, cb) {
    cb(null, randomName(file.originalname));
  },
});

function imageFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!IMAGE_EXTS.has(ext) || !IMAGE_MIMES.has(file.mimetype)) {
    cb(new Error('Avatar must be a PNG, JPEG, WEBP, GIF or SVG image'));
    return;
  }
  cb(null, true);
}

/** Upload handler for a user avatar (single image, ~5 MB). */
export const avatarUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, AVATARS_DIR);
    },
    filename(_req, file, cb) {
      cb(null, randomName(file.originalname));
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (file.fieldname !== 'avatar') {
      cb(new Error(`Unexpected field: ${file.fieldname}`));
      return;
    }
    imageFilter(req, file, cb);
  },
}).single('avatar');

/**
 * Upload handler for importing an app: one `content` file (.html/.zip) and an
 * optional `preview` image. Size capped by MAX_UPLOAD_MB.
 */
export const importUpload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 2 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'content') {
      if (!CONTENT_EXTS.has(ext)) {
        return cb(new Error('Only .html or .zip files are allowed'));
      }
      return cb(null, true);
    }
    if (file.fieldname === 'preview') {
      if (!IMAGE_EXTS.has(ext) || !IMAGE_MIMES.has(file.mimetype)) {
        return cb(new Error('Preview must be a PNG, JPEG, WEBP, GIF or SVG image'));
      }
      return cb(null, true);
    }
    return cb(new Error(`Unexpected field: ${file.fieldname}`));
  },
}).fields([
  { name: 'content', maxCount: 1 },
  { name: 'preview', maxCount: 1 },
]);

/** Upload handler for replacing just an app's content (.html/.zip) on update. */
export const contentUpload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.fieldname !== 'content') {
      return cb(new Error(`Unexpected field: ${file.fieldname}`));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!CONTENT_EXTS.has(ext)) {
      return cb(new Error('Only .html or .zip files are allowed'));
    }
    return cb(null, true);
  },
}).single('content');

/** Upload handler for replacing just the preview image (app edit). */
export const previewUpload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname !== 'preview') {
      return cb(new Error(`Unexpected field: ${file.fieldname}`));
    }
    if (!IMAGE_EXTS.has(ext) || !IMAGE_MIMES.has(file.mimetype)) {
      return cb(new Error('Preview must be a PNG, JPEG, WEBP, GIF or SVG image'));
    }
    return cb(null, true);
  },
}).single('preview');
