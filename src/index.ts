import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { ImageMetadata, ImageListResponse } from "./types";
import { sonyflake } from "./sonyflake62";

const ALLOW_DELETES = false;

const app = new Hono<{ Bindings: Env }>();

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function sharePageHtml(opts: {
	baseUrl: string;
	id: string;
	mimeType: string;
	width?: number;
	height?: number;
}): string {
	const { baseUrl, id, mimeType, width, height } = opts;
	const isVideo = mimeType.startsWith("video/");
	const assetUrl = `${baseUrl}/${id}`;
	const pageUrl = `${baseUrl}/p/${id}`;
	const title = isVideo ? `Video ${id}` : `Image ${id}`;
	const description = isVideo
		? "Shared video from Image CDN"
		: "Shared image from Image CDN";
	const ogType = isVideo ? "video.other" : "website";
	// Videos have no per-asset poster yet; use the site icon so crawlers still get og:image.
	const imageUrl = isVideo
		? `${baseUrl}/android-chrome-512x512.png`
		: assetUrl;
	const imageType = isVideo ? "image/png" : mimeType;

	const dimensionTags =
		!isVideo && width && height
			? `
    <meta property="og:image:width" content="${width}" />
    <meta property="og:image:height" content="${height}" />`
			: "";

	const imageTags = `
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="${escapeHtml(imageType)}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />${dimensionTags}
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`;

	const videoTags = isVideo
		? `
    <meta property="og:video" content="${escapeHtml(assetUrl)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(assetUrl)}" />
    <meta property="og:video:type" content="${escapeHtml(mimeType)}" />`
		: "";

	const mediaTags = `${imageTags}${videoTags}`;

	const bodyMedia = isVideo
		? `<video src="${escapeHtml(assetUrl)}" controls playsinline style="max-width:100%;max-height:80vh"></video>`
		: `<img src="${escapeHtml(assetUrl)}" alt="${escapeHtml(title)}" style="max-width:100%;max-height:80vh;height:auto" />`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:site_name" content="Image CDN" />${mediaTags}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
</head>
<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#111;color:#eee;font-family:system-ui,sans-serif">
    ${bodyMedia}
    <p style="margin:0;font-family:ui-monospace,monospace;font-size:0.875rem;opacity:0.7">
        <a href="${escapeHtml(assetUrl)}" style="color:inherit">${escapeHtml(`/${id}`)}</a>
    </p>
</body>
</html>`;
}

app
	.use("*", cors())
	.get(
		"/image",
		zValidator(
			"query",
			z.object({
				page: z
					.string()
					.transform(Number)
					.refine((p) => p > 0)
					.optional(),
				perPage: z
					.string()
					.transform(Number)
					.refine((pp) => pp > 0 && pp <= 100)
					.optional(),
			}),
		),
		async (c) => {
			const { page = 1, perPage = 10 } = c.req.valid("query");

			const keys = await c.env.image_metadata.list({ limit: 1000 });
			const allImages = await Promise.all(
				keys.keys.map((key) => {
					const metadata = c.env.image_metadata.get<ImageMetadata>(key.name, {
						type: "json",
					});
					return metadata;
				}),
			);

			const sortedImages = allImages
				.filter((img): img is ImageMetadata => img !== null)
				.sort((a, b) => b.uploadedAt - a.uploadedAt);

			const start = (page - 1) * perPage;
			const end = start + perPage;
			const pageImages = sortedImages.slice(start, end);

			const res: ImageListResponse = {
				images: pageImages,
				total: sortedImages.length,
				page,
				perPage,
			};
			return c.json(res);
		},
	)
	.get("/p/:id", async (c) => {
		const id = c.req.param("id");
		const metadata = await c.env.image_metadata.get<ImageMetadata>(id, {
			type: "json",
		});
		if (!metadata) return c.notFound();

		const object = await c.env.cdn_images.head(id);
		if (!object) return c.notFound();

		const baseUrl = new URL(c.req.url).origin;
		c.header("Cache-Control", "public, max-age=300");
		return c.html(
			sharePageHtml({
				baseUrl,
				id,
				mimeType: metadata.mimeType,
				width: metadata.width,
				height: metadata.height,
			}),
		);
	})
	.get("/:id", async (c) => {
		const id = c.req.param("id");
		const object = await c.env.cdn_images.get(id);
		if (!object) return c.notFound();

		const metadata = await c.env.image_metadata.get<ImageMetadata>(id, {
			type: "json",
		});
		if (!metadata) {
			return c.notFound();
		}

		return new Response(object.body, {
			headers: {
				"Content-Type": metadata.mimeType,
				"Cache-Control": "public, max-age=300",
			},
		});
	})
	.post("/upload", async (c) => {
		try {
			const formData = await c.req.formData();
			const file = formData.get("image") as File;
			if (!file) {
				return c.text("No file provided", 400);
			}
			if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
				return c.text("Invalid file type. Only images and videos are allowed.", 400);
			}

			const id = sonyflake.toBase62(sonyflake.nextId());
			const buffer = await file.arrayBuffer();

			// metadata in KV
			const metadata: ImageMetadata = {
				id,
				mimeType: file.type,
				uploadedAt: Date.now(),
				size: buffer.byteLength,
			};
			await c.env.image_metadata.put(id, JSON.stringify(metadata));

			// data in R2
			await c.env.cdn_images.put(id, buffer, {
				httpMetadata: {
					contentType: file.type,
				},
			});

			return c.json({
				success: true,
				id,
				message: "Image uploaded successfully",
			});
		} catch (error) {
			return c.text(
				error instanceof Error ? error.message : "Invalid request",
				400,
			);
		}
	})
	.delete("/:id", async (c) => {
		const id = c.req.param("id");
		if (ALLOW_DELETES) {
			await c.env.cdn_images.delete(id);
			await c.env.image_metadata.delete(id);
			return c.text("Image deleted", 200);
		}
		return c.text("Image deletion disabled", 403);
	});

export default app;
