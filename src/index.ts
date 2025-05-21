import { DurableObject } from 'cloudflare:workers';

// Add type declarations
declare function createImageBitmap(image: Blob): Promise<ImageBitmap>;
interface ImageBitmap {
	width: number;
	height: number;
	close(): void;
}

interface ImageRequest {
	image: string;
}

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject {
	private state: DurableObjectState;
	private readonly MAX_SIZE = 10 * 1024 * 1024; // 10MB
	private readonly CACHE_DURATION = 300; // 5 minutes

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

	async validateImage(buffer: ArrayBuffer): Promise<boolean> {
		// Check PNG signature (magic numbers)
		const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const header = new Uint8Array(buffer.slice(0, 8));

		// Compare the header with PNG signature
		if (header.length !== pngSignature.length) return false;
		for (let i = 0; i < pngSignature.length; i++) {
			if (header[i] !== pngSignature[i]) return false;
		}

		// Try to create an image bitmap to validate the image data
		try {
			await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
			return true;
		} catch (error) {
			return false;
		}
	}

	async retrieveImage(hash: string) {
		// get blob from sql storage
		const image = await this.state.storage.get(hash);
		if (!image) {
			return null;
		}
		// Convert the stored value to an ArrayBuffer
		const imageBuffer = new Uint8Array(image as ArrayBuffer);
		return imageBuffer;
	}

	async storeImage(pngBuffer: ArrayBuffer): Promise<string> {
		// Validate size
		if (pngBuffer.byteLength > this.MAX_SIZE) {
			throw new Error('Image size exceeds 10MB limit');
		}

		// Validate format
		if (!(await this.validateImage(pngBuffer))) {
			throw new Error('Invalid image format. Only PNG is supported');
		}

		// Create a fast hash of the buffer
		const hashBuffer = await crypto.subtle.digest('SHA-256', pngBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

		// store blob in sql storage
		await this.state.storage.put(hash, pngBuffer);
		return hash;
	}

	async deleteImage(hash: string): Promise<void> {
		await this.state.storage.delete(hash);
	}

	async getCacheDuration(): Promise<number> {
		return this.CACHE_DURATION;
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const id = env.MY_DURABLE_OBJECT.idFromName('foo');
		const stub = env.MY_DURABLE_OBJECT.get(id);

		// Handle different endpoints
		if (url.pathname.startsWith('/image/')) {
			const hash = url.pathname.split('/image/')[1];

			if (request.method === 'GET') {
				const image = await stub.retrieveImage(hash);
				if (!image) {
					return new Response('Image not found', { status: 404 });
				}
				const cacheDuration = await stub.getCacheDuration();
				return new Response(image, {
					headers: {
						'Content-Type': 'image/png',
						'Cache-Control': `public, max-age=${cacheDuration}`,
					},
				});
			}

			if (request.method === 'DELETE') {
				await stub.deleteImage(hash);
				return new Response('Image deleted', { status: 200 });
			}
		}

		if (url.pathname === '/image' && request.method === 'PUT') {
			try {
				const json = (await request.json()) as ImageRequest;
				if (!json.image || typeof json.image !== 'string') {
					return new Response('Invalid request: image field must be a base64 string', { status: 400 });
				}

				// Decode base64
				const base64Data = json.image.replace(/^data:image\/png;base64,/, '');
				const imageBuffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0)).buffer;

				const hash = await stub.storeImage(imageBuffer);
				return new Response(JSON.stringify({ hash }), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error) {
				if (error instanceof Error) {
					return new Response(error.message, { status: 400 });
				}
				return new Response('Invalid request', { status: 400 });
			}
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
