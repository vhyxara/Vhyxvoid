// The media library: uploads are processed (upright, metadata stripped,
// scaled down, thumbnail), unsafe or unreadable files are refused, images are
// served with long caching, and a used image isn't deleted by accident.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { adminMediaRoutes, publicMediaRoutes } from "../../apps/api/src/modules/platform/media/media.routes";
import { mediaFilename } from "../../apps/api/src/modules/platform/media/media.service";
import { adminBlogRoutes } from "../../apps/api/src/modules/platform/blog/blog.routes";

const require = createRequire(import.meta.url);
const Fastify = require("../../apps/api/node_modules/fastify");
const sharp = require("../../apps/api/node_modules/sharp");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("media file names", () => {
  it("are safe and readable", () => {
    expect(mediaFilename("Team Photo (Final) 2.JPG", "image/jpeg")).toBe("team-photo-final-2.jpg");
    expect(mediaFilename("../../etc/passwd", "image/png")).toBe("etc-passwd.png");
    expect(mediaFilename("Écran été.webp", "image/webp")).toBe("ecran-ete.webp");
    expect(mediaFilename("???", "image/gif")).toBe("image.gif");
  });
});

describe.skipIf(!url)("media library", { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const ids: string[] = [];
  const posts: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000c", email: "media@test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(adminMediaRoutes, { prefix: "/api/v1/admin/media" });
    await f.register(publicMediaRoutes, { prefix: "/api/v1/public/media" });
    await f.register(adminBlogRoutes, { prefix: "/api/v1/admin/blog" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await prisma.blogPost.deleteMany({ where: { id: { in: posts } } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const upload = (body: Buffer | string, type: string, name = "photo.jpg") =>
    f.inject({ method: "POST", url: "/api/v1/admin/media", payload: body, headers: { "content-type": type, "x-filename": encodeURIComponent(name), "x-alt": encodeURIComponent("A test image") } }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));

  it("turns photos upright, strips their metadata, scales them down and makes a thumbnail", async () => {
    // 3000×2000 landscape, EXIF says "rotate 90°" (a phone held upright), with camera and GPS data.
    const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#8b5cf6" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: "PhoneCo", Model: "X1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1" } } })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeTruthy();
    const r = await upload(photo, "image/jpeg", "Holiday Photo.JPG");
    expect(r.status).toBe(201);
    ids.push(r.body.data.id);
    expect(r.body.data).toMatchObject({ filename: "holiday-photo.jpg", mime: "image/jpeg", width: 2000, height: 3000, alt: "A test image" });
    expect(r.body.data.url).toBe(`/media/${r.body.data.id}/holiday-photo.jpg`);

    const stored = await prisma.mediaAsset.findUnique({ where: { id: r.body.data.id } });
    const meta = await sharp(Buffer.from(stored!.data)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([2000, 3000]);
    const thumb = await sharp(Buffer.from(stored!.thumb)).metadata();
    expect(thumb).toMatchObject({ format: "webp", width: 480 });

    const wide = await sharp({ create: { width: 4000, height: 1000, channels: 4, background: "#22d3ee80" } }).png().toBuffer();
    const w = await upload(wide, "image/png", "banner.png");
    ids.push(w.body.data.id);
    expect(w.body.data).toMatchObject({ width: 2400, height: 600, mime: "image/png" });
  });

  it("refuses SVG, files that aren't images, and empty uploads", async () => {
    const svg = await upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml", "x.svg");
    expect(svg.status).toBe(400);
    const junk = await upload(Buffer.from("definitely not an image"), "image/png");
    expect(junk.status).toBe(400);
    expect(junk.body.message).toMatch(/isn't an image/);
    expect((await upload(Buffer.alloc(0), "image/png")).status).toBe(400);
    const tooBig = await f.inject({ method: "POST", url: "/api/v1/admin/media", payload: Buffer.alloc(11 * 1024 * 1024), headers: { "content-type": "image/png" } });
    expect(tooBig.statusCode).toBe(413);
  });

  it("serves images and thumbnails, cached for good", async () => {
    const id = ids[0];
    const full = await f.inject({ method: "GET", url: `/api/v1/public/media/${id}` });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("image/jpeg");
    expect(full.headers["cache-control"]).toContain("immutable");
    expect(full.headers["x-content-type-options"]).toBe("nosniff");
    const thumb = await f.inject({ method: "GET", url: `/api/v1/public/media/${id}?thumb=1` });
    expect(thumb.headers["content-type"]).toBe("image/webp");
    expect(thumb.rawPayload.length).toBeLessThan(full.rawPayload.length);
    expect((await f.inject({ method: "GET", url: "/api/v1/public/media/not-an-id" })).statusCode).toBe(404);
  });

  it("lists, renames and describes images", async () => {
    const list = await f.inject({ method: "GET", url: "/api/v1/admin/media?search=holiday" }).then((r: any) => r.json());
    expect(list.items.map((i: any) => i.id)).toContain(ids[0]);
    expect(list.items[0].data).toBeUndefined(); // no bytes in the list
    const r = await f.inject({ method: "PATCH", url: `/api/v1/admin/media/${ids[0]}`, payload: { alt: "Our team on the beach", filename: "Team Beach" } }).then((x: any) => x.json());
    expect(r.data).toMatchObject({ alt: "Our team on the beach", filename: "team-beach.jpg" });
  });

  it("won't delete an image a post uses unless told to", async () => {
    const id = ids[1];
    const post = await f.inject({ method: "POST", url: "/api/v1/admin/blog/posts", payload: { title: `media ${Date.now()}`, body: "x", coverImageUrl: `/media/${id}/banner.png` } }).then((r: any) => r.json().data);
    posts.push(post.id);
    const usage = await f.inject({ method: "GET", url: `/api/v1/admin/media/${id}/usage` }).then((r: any) => r.json().data);
    expect(usage).toEqual([expect.objectContaining({ kind: "Blog post", href: `/blog/${post.id}` })]);
    const refused = await f.inject({ method: "DELETE", url: `/api/v1/admin/media/${id}` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/Still used in 1 place/);
    expect((await f.inject({ method: "DELETE", url: `/api/v1/admin/media/${id}?force=true` })).statusCode).toBe(200);
    expect(await prisma.mediaAsset.findUnique({ where: { id } })).toBeNull();
  });
});
