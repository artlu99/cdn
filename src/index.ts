import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import LandingPage from "./landing";

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

// Add type declarations
declare function createImageBitmap(image: Blob): Promise<ImageBitmap>;
interface ImageBitmap {
	width: number;
	height: number;
	close(): void;
}

interface ImageMetadata {
	size: number;
	uploadedAt: number;
	format: string;
	originalFormat?: string;
}

interface ImageRequest {
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
app
	.use("*", cors())
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

		const id = c.env.MY_DURABLE_OBJECT.idFromName("foo");
		const stub = c.env.MY_DURABLE_OBJECT.get(id) as unknown as MyDurableObject;
		const result = await stub.listImages(page, perPage);
		return c.json(result);
	})
	.get("/image/:hash", async (c) => {
		const hash = c.req.param("hash");
		const id = c.env.MY_DURABLE_OBJECT.idFromName("foo");
		const stub = c.env.MY_DURABLE_OBJECT.get(id) as unknown as MyDurableObject;

		const result = await stub.retrieveImage(hash);
		if (!result) {
			return c.text("Image not found", 404);
		}

		const cacheDuration = await stub.getCacheDuration();
		return new Response(result.buffer, {
			headers: {
				"Content-Type": result.mimeType,
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

			const id = c.env.MY_DURABLE_OBJECT.idFromName("foo");
			const stub = c.env.MY_DURABLE_OBJECT.get(
				id,
			) as unknown as MyDurableObject;

			// Decode base64
			const base64Data = json.image.replace(/^data:image\/\w+;base64,/, "");
			const imageBuffer = Uint8Array.from(atob(base64Data), (c) =>
				c.charCodeAt(0),
			).buffer;

			const hash = await stub.storeImage(imageBuffer, json.mimeType);
			return c.json({ hash });
		} catch (error) {
			if (error instanceof Error) {
				return c.text(error.message, 400);
			}
			return c.text("Invalid request", 400);
		}
	})
	.delete("/image/:hash", async (c) => {
		const hash = c.req.param("hash");
		const id = c.env.MY_DURABLE_OBJECT.idFromName("foo");
		const stub = c.env.MY_DURABLE_OBJECT.get(id) as unknown as MyDurableObject;

		await stub.deleteImage(hash);
		return c.text("Image deleted", 200);
	});

// Export the Hono app
export default app;
