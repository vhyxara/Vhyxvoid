// The media library: images admins upload for blog posts, pages and share
// previews. Every upload is processed before it is stored: turned upright
// (EXIF orientation), metadata stripped (camera, GPS), scaled down to at most
// 2400 px wide, plus a 480 px WebP thumbnail for the library grid. SVG is
// refused (it can carry scripts).
import sharp from "sharp";

import { ValidationError } from "@/core/errors/error.format";
import type { PrismaClient } from "@/generated/prisma";

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_WIDTH = 2400;
export const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"] as const;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

/** A safe, readable file name: lowercase words joined by -, the right extension. */
export function mediaFilename(original: string, mime: string): string {
  const base = original
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "image"}.${EXT[mime] ?? "bin"}`;
}

/** The website address of an image: on the site's own domain, served by apps/web (app/media). */
export const mediaPath = (a: { id: string; filename: string }) => `/media/${a.id}/${a.filename}`;

export type ProcessedImage = { data: Buffer; thumb: Buffer; mime: string; width: number; height: number };

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new ValidationError("That file isn't an image we can read");
  }
  const format = meta.format === "jpg" ? "jpeg" : meta.format;
  const mime = format === "heif" && meta.compression === "av1" ? "image/avif" : `image/${format}`;
  if (!(MEDIA_TYPES as readonly string[]).includes(mime)) throw new ValidationError("Use a PNG, JPEG, WebP, GIF or AVIF image (SVG isn't accepted)");

  const animated = mime === "image/gif" || (mime === "image/webp" && (meta.pages ?? 1) > 1);
  // rotate(): apply the EXIF orientation; sharp drops all metadata unless asked to keep it.
  const base = sharp(input, { animated, limitInputPixels: 60_000_000 }).rotate().resize({ width: MEDIA_MAX_WIDTH, withoutEnlargement: true });
  const encoded =
    mime === "image/jpeg" ? base.jpeg({ quality: 85, mozjpeg: true })
    : mime === "image/png" ? base.png({ compressionLevel: 9, palette: false })
    : mime === "image/webp" ? base.webp({ quality: 85 })
    : mime === "image/avif" ? base.avif({ quality: 60 })
    : base.gif();
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  const thumb = await sharp(input, { limitInputPixels: 60_000_000 }).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  // Animated images report the whole strip's height; one frame's height is pageHeight.
  return { data, thumb, mime, width: info.width, height: animated && info.pageHeight ? info.pageHeight : info.height };
}

/**
 * Where an image is used: blog posts (cover or body), website content
 * (pages, landing, footer), SEO overrides and the SEO settings. Matched on
 * the image's id, which appears in every address of it.
 */
export async function mediaUsage(prisma: PrismaClient, id: string): Promise<Array<{ kind: string; label: string; href: string }>> {
  const like = `%${id}%`;
  const [posts, entries, seo, settings] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; title: string }>>`SELECT id, title FROM blog_posts WHERE "coverImageUrl" LIKE ${like} OR body LIKE ${like} LIMIT 50`,
    prisma.$queryRaw<Array<{ id: string; title: string }>>`SELECT id, title FROM content_entries WHERE data::text LIKE ${like} OR "publishedData"::text LIKE ${like} LIMIT 50`,
    prisma.seoPage.findMany({ where: { imageUrl: { contains: id } }, select: { path: true }, take: 50 }),
    prisma.$queryRaw<Array<{ key: string }>>`SELECT key FROM system_settings WHERE value::text LIKE ${like} LIMIT 20`,
  ]);
  return [
    ...posts.map((p) => ({ kind: "Blog post", label: p.title, href: `/blog/${p.id}` })),
    ...entries.map((e) => ({ kind: "Website content", label: e.title, href: `/content/${e.id}` })),
    ...seo.map((s) => ({ kind: "SEO override", label: s.path, href: `/seo?tab=pages&path=${encodeURIComponent(s.path)}` })),
    ...settings.map((s) => ({ kind: "Setting", label: s.key, href: s.key.startsWith("seo.") ? "/seo?tab=defaults" : "/settings" })),
  ];
}
