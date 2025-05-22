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
