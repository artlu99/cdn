import { html } from "hono/html";

export default function LandingPage() {
	return html`
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Image CDN</title>
				<style>
					:root {
						--primary: #2563eb;
						--primary-hover: #1d4ed8;
						--background: #f8fafc;
						--text: #1e293b;
						--text-light: #64748b;
						--border: #e2e8f0;
					}

					* {
						margin: 0;
						padding: 0;
						box-sizing: border-box;
					}

					body {
						font-family: system-ui, -apple-system, sans-serif;
						background: var(--background);
						color: var(--text);
						line-height: 1.5;
					}

					.container {
						max-width: 1200px;
						margin: 0 auto;
						padding: 2rem;
					}

					header {
						text-align: center;
						margin-bottom: 3rem;
					}

					h1 {
						font-size: 2.5rem;
						margin-bottom: 1rem;
						color: var(--primary);
					}

					.upload-section {
						background: white;
						padding: 2rem;
						border-radius: 1rem;
						box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
						margin-bottom: 2rem;
					}

					.upload-options {
						display: flex;
						gap: 1rem;
						margin-bottom: 1rem;
					}

					.upload-option {
						flex: 1;
						text-align: center;
						padding: 1rem;
						background: var(--background);
						border: 2px solid var(--border);
						border-radius: 0.5rem;
						cursor: pointer;
						transition: all 0.2s;
					}

					.upload-option:hover {
						border-color: var(--primary);
						background: white;
					}

					.upload-option.active {
						border-color: var(--primary);
						background: white;
					}

					.upload-option input[type="file"] {
						display: none;
					}

					.upload-option svg {
						width: 24px;
						height: 24px;
						margin-bottom: 0.5rem;
						fill: var(--text);
					}

					.upload-option p {
						font-size: 0.875rem;
						color: var(--text);
					}

					.format-info {
						font-size: 0.875rem;
						color: var(--text-light);
						margin-top: 0.5rem;
						text-align: center;
					}

					.format-info ul {
						list-style: none;
						padding: 0;
						margin: 0.5rem 0;
					}

					.format-info li {
						display: inline-block;
						margin: 0 0.5rem;
					}

					.conversion-info {
						font-size: 0.75rem;
						color: var(--text-light);
						margin-top: 0.25rem;
						text-align: center;
						font-style: italic;
					}

					.preview-container {
						display: none;
						margin-top: 1rem;
						text-align: center;
					}

					.preview-container.active {
						display: block;
					}

					.preview-image {
						max-width: 100%;
						max-height: 300px;
						border-radius: 0.5rem;
						margin-bottom: 1rem;
					}

					.upload-form {
						display: flex;
						gap: 1rem;
						align-items: center;
					}

					.upload-button {
						background: var(--primary);
						color: white;
						border: none;
						padding: 0.75rem 1.5rem;
						border-radius: 0.5rem;
						cursor: pointer;
						font-weight: 500;
						transition: background 0.2s;
					}

					.upload-button:hover {
						background: var(--primary-hover);
					}

					.upload-button:disabled {
						opacity: 0.5;
						cursor: not-allowed;
					}

					.recent-uploads {
						background: white;
						padding: 2rem;
						border-radius: 1rem;
						box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
					}

					.recent-uploads h2 {
						margin-bottom: 1.5rem;
						color: var(--text);
					}

					.image-grid {
						display: grid;
						grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
						gap: 1.5rem;
					}

					.image-card {
						background: var(--background);
						border-radius: 0.5rem;
						overflow: hidden;
						transition: transform 0.2s;
					}

					.image-card:hover {
						transform: translateY(-2px);
					}

					.image-preview {
						width: 100%;
						aspect-ratio: 1;
						object-fit: cover;
					}

					.image-info {
						padding: 1rem;
					}

					.image-info p {
						font-size: 0.875rem;
						color: var(--text-light);
					}

					.loading {
						text-align: center;
						padding: 2rem;
						color: var(--text-light);
					}

					.error {
						background: #fee2e2;
						color: #dc2626;
						padding: 1rem;
						border-radius: 0.5rem;
						margin-bottom: 1rem;
					}

					@media (max-width: 640px) {
						.upload-options {
							flex-direction: column;
						}

						.upload-form {
							flex-direction: column;
						}

						.upload-button {
							width: 100%;
						}
					}
				</style>
			</head>
			<body>
				<div class="container">
					<header>
						<h1>Image CDN</h1>
						<p>Upload and manage your images</p>
					</header>

					<section class="upload-section">
						<div class="upload-options">
							<label class="upload-option" id="fileOption">
								<input 
									type="file" 
									accept="image/*" 
									id="fileInput" 
								/>
								<svg viewBox="0 0 24 24">
									<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
								</svg>
								<p>Choose File</p>
							</label>
							<label class="upload-option" id="cameraOption">
								<input 
									type="file" 
									accept="image/*" 
									capture="environment" 
									id="cameraInput" 
								/>
								<svg viewBox="0 0 24 24">
									<path d="M12 15c1.66 0 3-1.31 3-2.97V5.97C15 4.31 13.66 3 12 3S9 4.31 9 5.97v6.06C9 13.69 10.34 15 12 15zm-1-4c0-.55.45-1 1-1s1 .45 1 1-.45 1-1 1-1-.45-1-1zm0-5c0-.55.45-1 1-1s1 .45 1 1v3c0 .55-.45 1-1 1s-1-.45-1-1V6z"/>
								</svg>
								<p>Take Photo</p>
							</label>
						</div>
						<div class="format-info">
							<p>Supported input formats:</p>
							<ul>
								<li>PNG</li>
								<li>JPEG</li>
								<li>HEIC</li>
								<li>WebP</li>
								<li>GIF</li>
								<li>BMP</li>
								<li>TIFF</li>
								<li>ICO</li>
							</ul>
							<p class="conversion-info">Images will be converted to PNG, JPEG, or WebP for optimal web delivery</p>
						</div>

						<div class="preview-container" id="previewContainer">
							<img id="previewImage" class="preview-image" alt="Preview" />
							<form class="upload-form" id="uploadForm">
								<button type="submit" class="upload-button" id="uploadButton">
									Upload
								</button>
							</form>
						</div>
					</section>
				</div>
			</body>
		</html>
	`;
}
