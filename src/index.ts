import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";

interface Env {
	MY_DURABLE_OBJECT: DurableObjectNamespace;
	IMAGES: {
		info(stream: ReadableStream<Uint8Array>): Promise<{
			format: string;
			fileSize: number;
			width: number;
			height: number;
		}>;
		input(stream: ReadableStream<Uint8Array>): {
			output(options: {
				format: "image/jpeg" | "image/png" | "image/webp";
				quality?: number;
			}): Promise<{
				response(): Promise<Response>;
				contentType(): string;
			}>;
		};
	};
}

export interface ImageMetadata {
	hash: string;
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

export interface ImageResponse {
	buffer: ArrayBuffer;
	mimeType: string;
}

export interface ImageRequest {
	image: string;
	mimeType: string;
}

interface ListResponse {
	hashes: Array<{
		hash: string;
		size: number;
		uploadedAt: number;
	}>;
	total: number;
	page: number;
	perPage: number;
}

export interface DurableObjectStub {
	getImageMetadata(hash: string): Promise<ImageMetadata | null>;
	getCacheDuration(): Promise<number>;
}

export interface MyDurableObject extends DurableObjectStub {
	listImages(page: number, perPage: number): Promise<ImageListResponse>;
	retrieveImage(hash: string): Promise<ImageResponse | null>;
	storeImage(buffer: ArrayBuffer, mimeType: string): Promise<string>;
	deleteImage(hash: string): Promise<void>;
}

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject {
	private state: DurableObjectState;
	private readonly MAX_SIZE = 10 * 1024 * 1024; // 10MB
	private readonly CACHE_DURATION = 300; // 5 minutes
	private readonly INPUT_FORMATS = [
		"image/png",
		"image/jpeg",
		"image/heic",
		"image/webp",
		"image/gif",
		"image/bmp",
		"image/tiff",
		"image/x-icon",
	];
	private readonly OUTPUT_FORMATS = ["image/png", "image/jpeg", "image/webp"];

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.state = ctx;
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}

	async validateImage(buffer: ArrayBuffer, mimeType: string): Promise<boolean> {
		// Check if format is allowed
		if (!this.INPUT_FORMATS.includes(mimeType)) {
			return false;
		}

		try {
			// Use Cloudflare Images API to validate the image
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(buffer));
					controller.close();
				},
			});

			await this.env.IMAGES.info(stream);
			return true;
		} catch (error) {
			return false;
		}
	}

	async convertImage(
		imageBuffer: ArrayBuffer,
		originalMimeType: string,
	): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
		// Create a stream from the buffer
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(imageBuffer));
				controller.close();
			},
		});

		// Choose the best output format
		let outputFormat = "image/png";
		if (
			originalMimeType === "image/jpeg" ||
			originalMimeType === "image/heic"
		) {
			outputFormat = "image/jpeg";
		} else if (originalMimeType === "image/webp") {
			outputFormat = "image/webp";
		}

		// Use Cloudflare Images API to convert the image
		const result = await this.env.IMAGES.input(stream).output({
			format: outputFormat as "image/jpeg" | "image/png" | "image/webp",
			quality: 85,
		});

		// Convert the result to ArrayBuffer
		const response = await result.response();
		const convertedBuffer = await response.arrayBuffer();

		return {
			buffer: convertedBuffer,
			mimeType: result.contentType(),
		};
	}

	async storeImage(
		imageBuffer: ArrayBuffer,
		originalMimeType: string,
	): Promise<string> {
		// Validate size
		if (imageBuffer.byteLength > this.MAX_SIZE) {
			throw new Error("Image size exceeds 10MB limit");
		}

		// Validate format
		if (!(await this.validateImage(imageBuffer, originalMimeType))) {
			throw new Error(
				`Invalid image format. Supported formats: ${this.INPUT_FORMATS.join(", ")}`,
			);
		}

		// Convert image to web-friendly format
		const { buffer: convertedBuffer, mimeType: outputFormat } =
			await this.convertImage(imageBuffer, originalMimeType);

		// Create a fast hash of the converted buffer
		const hashBuffer = await crypto.subtle.digest("SHA-256", convertedBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

		// Store converted image and metadata
		await this.state.storage.put(hash, convertedBuffer);
		await this.state.storage.put(`meta:${hash}`, {
			size: convertedBuffer.byteLength,
			uploadedAt: Date.now(),
			format: outputFormat,
			originalFormat: originalMimeType,
		});

		return hash;
	}

	async retrieveImage(hash: string) {
		const image = await this.state.storage.get(hash);
		const metadata = await this.getImageMetadata(hash);
		if (!image || !metadata) {
			return null;
		}
		return {
			buffer: new Uint8Array(image as ArrayBuffer),
			mimeType: metadata.format,
		};
	}

	async getImageMetadata(hash: string): Promise<ImageMetadata | null> {
		const metadata = await this.state.storage.get(`meta:${hash}`);
		return metadata as ImageMetadata | null;
	}

	async listImages(page = 1, perPage = 10): Promise<ListResponse> {
		const keys = await this.state.storage.list();
		const allHashes = Array.from(keys.keys())
			.filter((key) => !key.startsWith("meta:"))
			.sort();

		const start = (page - 1) * perPage;
		const end = start + perPage;
		const pageHashes = allHashes.slice(start, end);

		const images = await Promise.all(
			pageHashes.map(async (hash) => {
				const metadata = await this.getImageMetadata(hash);
				return {
					hash,
					size: metadata?.size ?? 0,
					uploadedAt: metadata?.uploadedAt ?? 0,
				};
			}),
		);

		return {
			hashes: images,
			total: allHashes.length,
			page,
			perPage,
		};
	}

	async deleteImage(hash: string): Promise<void> {
		await this.state.storage.delete(hash);
		await this.state.storage.delete(`meta:${hash}`);
	}

	async getCacheDuration(): Promise<number> {
		return this.CACHE_DURATION;
	}
}

const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use("*", cors());

// Helper function to generate meta tags for images
function generateImageMetaTags(hash: string, metadata: ImageMetadata) {
	const baseUrl = "https://cdn.artlu.workers.dev";
	const imageUrl = `${baseUrl}/i/${hash}`;
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
app.get("/meta/:hash", async (c) => {
	const hash = c.req.param("hash");
	const id = c.env.MY_DURABLE_OBJECT.idFromName(hash);
	const obj = c.env.MY_DURABLE_OBJECT.get(id);

	try {
		const metadata = await (
			obj as unknown as DurableObjectStub
		).getImageMetadata(hash);
		if (!metadata) {
			return c.notFound();
		}

		const metaTags = generateImageMetaTags(hash, metadata);

		// Set cache headers
		const cacheDuration = await (
			obj as unknown as DurableObjectStub
		).getCacheDuration();
		c.header("Cache-Control", `public, max-age=${cacheDuration}`);
		c.header("Content-Type", "text/html");

		return c.html(`
			<!DOCTYPE html>
			<html>
				<head>
					${metaTags}
				</head>
				<body>
					<script>
						window.location.href = "/i/${hash}";
					</script>
				</body>
			</html>
		`);
	} catch (error) {
		return c.notFound();
	}
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

		// Use a consistent ID for all operations
		const id = c.env.MY_DURABLE_OBJECT.idFromName("images");
		const stub = c.env.MY_DURABLE_OBJECT.get(id);
		const result = await (stub as unknown as MyDurableObject).listImages(
			page,
			perPage,
		);
		return c.json(result);
	})
	.get("/image/:hash", async (c) => {
		const hash = c.req.param("hash");
		// Use the same ID as other operations
		const id = c.env.MY_DURABLE_OBJECT.idFromName("images");
		const stub = c.env.MY_DURABLE_OBJECT.get(id);

		const result = await (stub as unknown as MyDurableObject).retrieveImage(
			hash,
		);
		if (!result) {
			return c.text("Image not found", 404);
		}

		const cacheDuration = await (
			stub as unknown as MyDurableObject
		).getCacheDuration();
		return new Response(result.buffer, {
			headers: {
				"Content-Type": result.mimeType ?? "image/jpeg",
				"Cache-Control": `public, max-age=${cacheDuration}`,
			},
		});
	})
	.put("/image", async (c) => {
		try {
			const json = (await c.req.json()) as ImageRequest;
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

			const id = c.env.MY_DURABLE_OBJECT.idFromName("images");
			const stub = c.env.MY_DURABLE_OBJECT.get(id);

			// Decode base64
			const base64Data = json.image.replace(/^data:image\/\w+;base64,/, "");
			const imageBuffer = Uint8Array.from(atob(base64Data), (c) =>
				c.charCodeAt(0),
			).buffer;

			const hash = await (stub as unknown as MyDurableObject).storeImage(
				imageBuffer,
				json.mimeType,
			);
			return c.json({ hash });
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

			const id = c.env.MY_DURABLE_OBJECT.idFromName("images");
			const stub = c.env.MY_DURABLE_OBJECT.get(id);

			const hash = await (stub as unknown as MyDurableObject).storeImage(
				buffer,
				file.type,
			);

			// Return success response with the hash
			return c.json({
				success: true,
				hash,
				message: "Image uploaded successfully",
			});
		} catch (error) {
			if (error instanceof Error) {
				return c.text(error.message, 400);
			}
			return c.text("Invalid request", 400);
		}
	})
	.delete("/image/:hash", async (c) => {
		const hash = c.req.param("hash");
		const id = c.env.MY_DURABLE_OBJECT.idFromName("images");
		const stub = c.env.MY_DURABLE_OBJECT.get(id);

		await (stub as unknown as MyDurableObject).deleteImage(hash);
		return c.text("Image deleted", 200);
	});

// Export the Hono app
export default app;
