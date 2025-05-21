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

// Helper function to generate meta tags for images
export function generateImageMetaTags(env: Env, id: string, metadata: ImageMetadata) {
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