import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { ImageMetadata, ImageListResponse } from "./types";
import { sonyflake } from "./sonyflake62";

const ALLOW_DELETES = false;

const app = new Hono<{ Bindings: Env }>();

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
