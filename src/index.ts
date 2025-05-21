/// <reference lib="webworker" />
import { Hono } from "hono";
import { cors } from "hono/cors";
import { nanoid } from "nanoid";

export interface ImageMetadata {
	id: string;
	mimeType: string;
	uploadedAt: number;
	width?: number;
	height?: number;
	format?: string;
	size: number;
}

export interface ImageListResponse {
	images: ImageMetadata[];
	total: number;
	page: number;
	perPage: number;
}

const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use("*", cors());

// Helper function to generate meta tags for images
function generateImageMetaTags(env: Env, id: string, metadata: ImageMetadata) {
	const baseUrl = env.BASE_URL;
	const imageUrl = `${baseUrl}/i/${id}`;
	const uploadDate = new Date(metadata.uploadedAt).toLocaleDateString();

	return [
		// Basic meta tags
		`<title>Image uploaded on ${uploadDate}</title>`,
		`<meta name="description" content="View image uploaded on ${uploadDate}" />`,

		// Open Graph tags
		`<meta property="og:title" content="Image uploaded on ${uploadDate}" />`,
		`<meta property="og:type" content="article" />`,
		`<meta property="og:url" content="${imageUrl}" />`,
		`<meta property="og:description" content="View image uploaded on ${uploadDate}" />`,
		`<meta property="og:site_name" content="Image CDN" />`,
		`<meta property="og:image" content="${imageUrl}" />`,
		`<meta property="og:image:width" content="${metadata.width || 1200}" />`,
		`<meta property="og:image:height" content="${metadata.height || 630}" />`,
		`<meta property="og:image:alt" content="Image uploaded on ${uploadDate}" />`,

		// Twitter Card tags
		`<meta name="twitter:card" content="summary_large_image" />`,
		`<meta name="twitter:title" content="Image uploaded on ${uploadDate}" />`,
		`<meta name="twitter:description" content="View image uploaded on ${uploadDate}" />`,
		`<meta name="twitter:image" content="${imageUrl}" />`,

		// Additional meta tags for better sharing
		`<meta property="og:image:type" content="${metadata.format || "image/jpeg"}" />`,
		`<meta property="og:image:secure_url" content="${imageUrl}" />`,
		`<meta name="twitter:image:alt" content="Image uploaded on ${uploadDate}" />`,
	].join("\n");
}

// Add meta tags endpoint for images
app.get("/meta/:id", async (c) => {
	const id = c.req.param("id");
	const metadata = await c.env.IMAGE_METADATA.get<ImageMetadata>(id, {
		type: "json",
	});

	if (!metadata) {
		return c.notFound();
	}

	const metaTags = generateImageMetaTags(c.env, id, metadata);

	// Set cache headers
	c.header("Cache-Control", "public, max-age=300");
	c.header("Content-Type", "text/html");

	return c.html(`
		<!DOCTYPE html>
		<html>
			<head>
				${metaTags}
			</head>
			<body>
				<script>
					window.location.href = "/i/${id}";
				</script>
			</body>
		</html>
	`);
});

app
	.get("/image", async (c) => {
		const page = Number.parseInt(c.req.query("page") ?? "1");
		const perPage = Number.parseInt(c.req.query("perPage") ?? "10");

		if (
			Number.isNaN(page) ||
			page < 1 ||
			Number.isNaN(perPage) ||
			perPage < 1 ||
			perPage > 100
		) {
			return c.text("Invalid pagination parameters", 400);
		}

		// List all keys in KV
		const keys = await c.env.IMAGE_METADATA.list({ limit: 1000 });
		const allImages = await Promise.all(
			keys.keys.map(async (key) => {
				const metadata = await c.env.IMAGE_METADATA.get<ImageMetadata>(
					key.name,
					{ type: "json" },
				);
				return metadata;
			}),
		);

		// Sort by upload date and paginate
		const sortedImages = allImages
			.filter((img): img is ImageMetadata => img !== null)
			.sort((a, b) => b.uploadedAt - a.uploadedAt);

		const start = (page - 1) * perPage;
		const end = start + perPage;
		const pageImages = sortedImages.slice(start, end);

		return c.json({
			images: pageImages,
			total: sortedImages.length,
			page,
			perPage,
		});
	})
	.get("/image/:id", async (c) => {
		const id = c.req.param("id");
		const object = await c.env.CDN_IMAGES.get(id);

		if (!object) {
			return c.text("Image not found", 404);
		}

		const metadata = await c.env.IMAGE_METADATA.get<ImageMetadata>(id, {
			type: "json",
		});
		if (!metadata) {
			return c.text("Image metadata not found", 404);
		}

		return new Response(object.body, {
			headers: {
				"Content-Type": metadata.mimeType,
				"Cache-Control": "public, max-age=300",
			},
		});
	})
	.put("/image", async (c) => {
		try {
			const json = await c.req.json();
			if (
				!json.image ||
				typeof json.image !== "string" ||
				!json.mimeType ||
				typeof json.mimeType !== "string"
			) {
				return c.text(
					"Invalid request: image field must be a base64 string and mimeType must be specified",
					400,
				);
			}

			// Decode base64
			const base64Data = json.image.replace(/^data:image\/\w+;base64,/, "");
			const imageBuffer = Uint8Array.from(atob(base64Data), (c) =>
				c.charCodeAt(0),
			).buffer;

			// Generate ID
			const id = nanoid();

			// Store in R2
			await c.env.CDN_IMAGES.put(id, imageBuffer, {
				httpMetadata: {
					contentType: json.mimeType,
				},
			});

			// Store metadata in KV
			const metadata: ImageMetadata = {
				id,
				mimeType: json.mimeType,
				uploadedAt: Date.now(),
				size: imageBuffer.byteLength,
			};

			await c.env.IMAGE_METADATA.put(id, JSON.stringify(metadata));

			return c.json({ id });
		} catch (error) {
			if (error instanceof Error) {
				return c.text(error.message, 400);
			}
			return c.text("Invalid request", 400);
		}
	})
	.post("/upload", async (c) => {
		try {
			const formData = await c.req.formData();
			const file = formData.get("image") as File;

			if (!file) {
				return c.text("No file provided", 400);
			}

			// Validate file type
			if (!file.type.startsWith("image/")) {
				return c.text("Invalid file type. Only images are allowed.", 400);
			}

			// Convert File to ArrayBuffer
			const buffer = await file.arrayBuffer();

			// Generate ID
			const id = nanoid();

			// Store in R2
			await c.env.CDN_IMAGES.put(id, buffer, {
				httpMetadata: {
					contentType: file.type,
				},
			});

			// Store metadata in KV
			const metadata: ImageMetadata = {
				id,
				mimeType: file.type,
				uploadedAt: Date.now(),
				size: buffer.byteLength,
			};

			await c.env.IMAGE_METADATA.put(id, JSON.stringify(metadata));

			// Return success response with the id
			return c.json({
				success: true,
				id,
				message: "Image uploaded successfully",
			});
		} catch (error) {
			if (error instanceof Error) {
				return c.text(error.message, 400);
			}
			return c.text("Invalid request", 400);
		}
	})
	.delete("/image/:id", async (c) => {
		const id = c.req.param("id");

		// Delete from R2
		await c.env.CDN_IMAGES.delete(id);

		// Delete from KV
		await c.env.IMAGE_METADATA.delete(id);

		return c.text("Image deleted", 200);
	});

// Export the Hono app
export default app;
