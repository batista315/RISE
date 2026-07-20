"use strict";

const MAX_UPLOAD_BYTES = 99_000_000;
const DISPLAY_LIMIT_MB = 95;
const EXPIRATION_HOURS = 72;

const IMAGE_TYPES = new Map([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
	["image/gif", "gif"],
	["image/avif", "avif"],
	["image/heic", "heic"],
	["image/heif", "heif"],
	["image/bmp", "bmp"],
	["image/tiff", "tiff"],
]);

export default {
	async fetch(request, env) {
		try {
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: corsHeaders(request),
				});
			}

			const url = new URL(request.url);

			if (request.method === "GET" && url.pathname === "/") {
				return jsonResponse(
					{
						service: "RISE Upload Worker",
						status: "ok",
						displayUploadLimitMB: DISPLAY_LIMIT_MB,
						hardUploadLimitBytes: MAX_UPLOAD_BYTES,
						autoDeleteAfterHours: EXPIRATION_HOURS,
						searchHelpers: ["baidu", "same-energy"],
						build: "stable-18-url-import-v1",
					},
					200,
					request,
				);
			}

			if (
				request.method === "POST" &&
				url.pathname === "/upload"
			) {
				return handleUpload(request, env);
			}

			
			if (
				request.method === "POST" &&
				url.pathname === "/import-url"
			) {
				return handleImportUrl(request, env);
			}
if (
				request.method === "POST" &&
				url.pathname === "/search/baidu"
			) {
				return handleBaiduSearch(request, env);
			}

			if (
				request.method === "POST" &&
				url.pathname === "/search/same-energy"
			) {
				return handleSameEnergySearch(request, env);
			}

			if (
				(request.method === "GET" ||
					request.method === "HEAD") &&
				url.pathname.startsWith("/i/")
			) {
				return handleImageRequest(request, env, url);
			}

			return jsonResponse(
				{
					error: "Not found.",
				},
				404,
				request,
			);
		} catch (error) {
			console.error(error);

			return jsonResponse(
				{
					error: "The request could not be completed.",
				},
				500,
				request,
			);
		}
	},
};

async function handleImportUrl(request, env) {
	const unauthorized = authorizeRequest(request, env);

	if (unauthorized) {
		return unauthorized;
	}

	let body;

	try {
		body = await request.json();
	} catch {
		return jsonResponse(
			{
				error: "The import request did not contain valid JSON.",
			},
			400,
			request,
		);
	}

	const sourceUrl = normalizeImportImageUrl(body?.url);

	if (!sourceUrl) {
		return jsonResponse(
			{
				error: "The pasted image URL is not a permitted public URL.",
			},
			400,
			request,
		);
	}

	let imageResponse;

	try {
		imageResponse = await fetchRemoteImage(sourceUrl);
	} catch (error) {
		return jsonResponse(
			{
				error:
					error instanceof Error
						? error.message
						: "RISE could not download the pasted image.",
			},
			502,
			request,
		);
	}

	const declaredLength = Number(
		imageResponse.headers.get("Content-Length") || 0,
	);

	if (
		declaredLength &&
		declaredLength > MAX_UPLOAD_BYTES
	) {
		return jsonResponse(
			{
				error:
					`The pasted image exceeds the ${DISPLAY_LIMIT_MB} MB displayed upload limit.`,
			},
			413,
			request,
		);
	}

	let bytes;

	try {
		bytes = await readResponseWithLimit(
			imageResponse,
			MAX_UPLOAD_BYTES,
		);
	} catch (error) {
		return jsonResponse(
			{
				error:
					error instanceof Error
						? error.message
						: "The pasted image could not be downloaded.",
			},
			413,
			request,
		);
	}

	if (!bytes.byteLength) {
		return jsonResponse(
			{
				error: "The pasted image was empty.",
			},
			400,
			request,
		);
	}

	const headerContentType = normalizeContentType(
		imageResponse.headers.get("Content-Type"),
	);

	const contentType =
		detectImageContentType(bytes, headerContentType);

	const extension = IMAGE_TYPES.get(contentType);

	if (!extension) {
		return jsonResponse(
			{
				error:
					"The pasted URL did not return a supported image file.",
				receivedContentType:
					headerContentType || "unknown",
			},
			415,
			request,
		);
	}

	const filename =
		`${crypto.randomUUID().replaceAll("-", "")}.${extension}`;

	try {
		await env.rise_temp_images.put(
			`uploads/${filename}`,
			bytes,
			{
				httpMetadata: {
					contentType,
				},

				customMetadata: {
					uploadedAt: new Date().toISOString(),
					expiresAfterHours:
						String(EXPIRATION_HOURS),
					importedFromUrl: "true",
				},
			},
		);
	} catch (error) {
		console.error("R2 URL import failed:", error);

		return jsonResponse(
			{
				error:
					"The pasted image could not be saved to RISE storage.",
			},
			500,
			request,
		);
	}

	const workerOrigin = new URL(request.url).origin;

	return jsonResponse(
		{
			url: `${workerOrigin}/i/${filename}`,
			filename,
			contentType,
			size: bytes.byteLength,
			expiresAfterHours: EXPIRATION_HOURS,
		},
		201,
		request,
	);
}

async function fetchRemoteImage(initialUrl) {
	let currentUrl = initialUrl;

	for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
		const safeUrl = normalizeImportImageUrl(currentUrl);

		if (!safeUrl) {
			throw new Error(
				"The image URL redirected to a blocked or private address.",
			);
		}

		let response;

		try {
			response = await fetch(safeUrl.href, {
				method: "GET",
				redirect: "manual",

				headers: {
					Accept:
						"image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.9",
					Referer: `${safeUrl.origin}/`,
					"User-Agent":
						"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
				},
			});
		} catch {
			throw new Error(
				"RISE could not connect to the website hosting the pasted image.",
			);
		}

		if (
			[301, 302, 303, 307, 308].includes(
				response.status,
			)
		) {
			const location =
				response.headers.get("Location");

			if (!location) {
				throw new Error(
					"The image website returned an invalid redirect.",
				);
			}

			currentUrl = new URL(
				location,
				safeUrl,
			).href;

			continue;
		}

		if (!response.ok) {
			throw new Error(
				`The image website returned status ${response.status}.`,
			);
		}

		return response;
	}

	throw new Error(
		"The image URL redirected too many times.",
	);
}

async function readResponseWithLimit(response, maximumBytes) {
	if (!response.body) {
		const bytes = await response.arrayBuffer();

		if (bytes.byteLength > maximumBytes) {
			throw new Error(
				`The pasted image exceeds the ${DISPLAY_LIMIT_MB} MB displayed upload limit.`,
			);
		}

		return bytes;
	}

	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;

	while (true) {
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		if (!value?.byteLength) {
			continue;
		}

		totalBytes += value.byteLength;

		if (totalBytes > maximumBytes) {
			await reader.cancel();

			throw new Error(
				`The pasted image exceeds the ${DISPLAY_LIMIT_MB} MB displayed upload limit.`,
			);
		}

		chunks.push(value);
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;

	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return combined.buffer;
}

function normalizeImportImageUrl(rawUrl) {
	if (typeof rawUrl !== "string") {
		return null;
	}

	let url;

	try {
		url = new URL(rawUrl.trim());
	} catch {
		return null;
	}

	if (
		url.protocol !== "http:" &&
		url.protocol !== "https:"
	) {
		return null;
	}

	if (url.username || url.password) {
		return null;
	}

	if (
		url.port &&
		!(
			(url.protocol === "http:" &&
				url.port === "80") ||
			(url.protocol === "https:" &&
				url.port === "443")
		)
	) {
		return null;
	}

	if (isBlockedImportHostname(url.hostname)) {
		return null;
	}

	url.hash = "";

	return url;
}

function isBlockedImportHostname(rawHostname) {
	const hostname = String(rawHostname || "")
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");

	if (
		!hostname ||
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".home.arpa")
	) {
		return true;
	}

	const ipv4Match = hostname.match(
		/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
	);

	if (ipv4Match) {
		const octets = ipv4Match
			.slice(1)
			.map(Number);

		if (
			octets.some(
				(value) =>
					!Number.isInteger(value) ||
					value < 0 ||
					value > 255,
			)
		) {
			return true;
		}

		const [a, b] = octets;

		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 0) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			a >= 224
		);
	}

	if (hostname.includes(":")) {
		const compact = hostname.replace(/^0+/, "");

		return (
			hostname === "::" ||
			hostname === "::1" ||
			hostname.startsWith("fc") ||
			hostname.startsWith("fd") ||
			/^fe[89ab]/.test(hostname) ||
			hostname.startsWith("::ffff:127.") ||
			hostname.startsWith("::ffff:10.") ||
			hostname.startsWith("::ffff:192.168.") ||
			compact === ":1"
		);
	}

	return false;
}

function detectImageContentType(
	arrayBuffer,
	headerContentType = "",
) {
	if (IMAGE_TYPES.has(headerContentType)) {
		return headerContentType;
	}

	const bytes = new Uint8Array(arrayBuffer);

	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}

	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}

	const ascii = (start, length) =>
		String.fromCharCode(
			...bytes.slice(start, start + length),
		);

	if (
		bytes.length >= 6 &&
		(
			ascii(0, 6) === "GIF87a" ||
			ascii(0, 6) === "GIF89a"
		)
	) {
		return "image/gif";
	}

	if (
		bytes.length >= 12 &&
		ascii(0, 4) === "RIFF" &&
		ascii(8, 4) === "WEBP"
	) {
		return "image/webp";
	}

	if (
		bytes.length >= 2 &&
		ascii(0, 2) === "BM"
	) {
		return "image/bmp";
	}

	if (
		bytes.length >= 4 &&
		(
			(
				bytes[0] === 0x49 &&
				bytes[1] === 0x49 &&
				bytes[2] === 0x2a &&
				bytes[3] === 0x00
			) ||
			(
				bytes[0] === 0x4d &&
				bytes[1] === 0x4d &&
				bytes[2] === 0x00 &&
				bytes[3] === 0x2a
			)
		)
	) {
		return "image/tiff";
	}

	if (
		bytes.length >= 12 &&
		ascii(4, 4) === "ftyp"
	) {
		const brand = ascii(8, 4).toLowerCase();

		if (brand === "avif" || brand === "avis") {
			return "image/avif";
		}

		if (
			[
				"heic",
				"heix",
				"hevc",
				"hevx",
			].includes(brand)
		) {
			return "image/heic";
		}

		if (
			brand === "mif1" ||
			brand === "msf1"
		) {
			return "image/heif";
		}
	}

	return "";
}

async function handleUpload(request, env) {
	const unauthorized = authorizeRequest(request, env);

	if (unauthorized) {
		return unauthorized;
	}

	const contentLengthHeader =
		request.headers.get("Content-Length");

	if (!contentLengthHeader) {
		return jsonResponse(
			{
				error: "The upload size could not be determined.",
			},
			411,
			request,
		);
	}

	const contentLength = Number(contentLengthHeader);

	if (
		!Number.isFinite(contentLength) ||
		contentLength <= 0
	) {
		return jsonResponse(
			{
				error: "The uploaded image is empty.",
			},
			400,
			request,
		);
	}

	if (contentLength > MAX_UPLOAD_BYTES) {
		return jsonResponse(
			{
				error:
					`The image exceeds the ${DISPLAY_LIMIT_MB} MB displayed upload limit.`,
				maxBytes: MAX_UPLOAD_BYTES,
			},
			413,
			request,
		);
	}

	const contentType = normalizeContentType(
		request.headers.get("Content-Type"),
	);

	const extension = IMAGE_TYPES.get(contentType);

	if (!extension) {
		return jsonResponse(
			{
				error: "That image type is not supported.",
			},
			415,
			request,
		);
	}

	const filename =
		`${crypto.randomUUID().replaceAll("-", "")}.${extension}`;

	const objectKey = `uploads/${filename}`;

	try {
		await env.rise_temp_images.put(
			objectKey,
			request.body,
			{
				httpMetadata: {
					contentType,
				},

				customMetadata: {
					uploadedAt: new Date().toISOString(),
					expiresAfterHours:
						String(EXPIRATION_HOURS),
				},
			},
		);
	} catch (error) {
		console.error("R2 upload failed:", error);

		return jsonResponse(
			{
				error: "The image could not be uploaded.",
			},
			500,
			request,
		);
	}

	const workerOrigin = new URL(request.url).origin;

	return jsonResponse(
		{
			url: `${workerOrigin}/i/${filename}`,
			filename,
			expiresAfterHours: EXPIRATION_HOURS,
			maxBytes: MAX_UPLOAD_BYTES,
		},
		201,
		request,
	);
}

async function handleImageRequest(request, env, url) {
	const filename = decodeURIComponent(
		url.pathname.slice("/i/".length),
	);

	if (
		!/^[a-f0-9]{32}\.(?:jpg|png|webp|gif|avif|heic|heif|bmp|tiff)$/i.test(
			filename,
		)
	) {
		return jsonResponse(
			{
				error: "Image not found.",
			},
			404,
			request,
		);
	}

	const object = await env.rise_temp_images.get(
		`uploads/${filename}`,
	);

	if (!object) {
		return jsonResponse(
			{
				error: "Image not found or expired.",
			},
			404,
			request,
		);
	}

	const headers = new Headers();

	object.writeHttpMetadata(headers);

	headers.set(
		"Content-Type",
		headers.get("Content-Type") ||
			"application/octet-stream",
	);
	headers.set("Content-Length", String(object.size));
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", "public, max-age=3600");
	headers.set("Content-Disposition", `inline; filename="${filename}"`);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
	headers.set("Access-Control-Allow-Origin", "*");

	return new Response(
		request.method === "HEAD" ? null : object.body,
		{
			status: 200,
			headers,
		},
	);
}

async function handleSameEnergySearch(request, env) {
	const unauthorized = authorizeRequest(request, env);

	if (unauthorized) {
		return unauthorized;
	}

	const contentType = normalizeContentType(
		request.headers.get("Content-Type"),
	);

	if (!IMAGE_TYPES.has(contentType)) {
		return jsonResponse(
			{
				error:
					`Same Energy does not support the supplied image type: ${contentType || "unknown"}.`,
			},
			415,
			request,
		);
	}

	const contentLength = Number(
		request.headers.get("Content-Length") || 0,
	);

	if (
		contentLength &&
		contentLength > MAX_UPLOAD_BYTES
	) {
		return jsonResponse(
			{
				error: "The image is too large for Same Energy.",
			},
			413,
			request,
		);
	}

	const bytes = await request.arrayBuffer();

	if (
		bytes.byteLength <= 0 ||
		bytes.byteLength > MAX_UPLOAD_BYTES
	) {
		return jsonResponse(
			{
				error: "The image size is not supported by Same Energy.",
			},
			400,
			request,
		);
	}

	let response;

	try {
		response = await fetch(
			`https://imageapi.same.energy/upload?length=${bytes.byteLength}`,
			{
				method: "PUT",

				headers: {
					"Content-Type": contentType,
					Accept: "application/json, text/plain, */*",
					Origin: "https://same.energy",
					Referer: "https://same.energy/",
				},

				body: bytes,
			},
		);
	} catch (error) {
		console.error("Same Energy upload failed:", error);

		return jsonResponse(
			{
				error: "Same Energy could not receive the image.",
			},
			502,
			request,
		);
	}

	const responseText = await response.text();

	if (!response.ok) {
		console.error(
			"Same Energy HTTP failure:",
			response.status,
			responseText,
		);

		return jsonResponse(
			{
				error:
					`Same Energy returned status ${response.status}.`,
			},
			502,
			request,
		);
	}

	const imageId =
		findSameEnergyImageId(responseText);

	if (!imageId) {
		console.error(
			"Same Energy response did not include an image id:",
			responseText,
		);

		return jsonResponse(
			{
				error:
					"Same Energy uploaded the image but did not return a usable search ID.",
			},
			502,
			request,
		);
	}

	return jsonResponse(
		{
			url:
				"https://same.energy/search?i=" +
				encodeURIComponent(imageId) +
				"&n=100&nsfw=1",
			engine: "same-energy",
			build: "stable-18-url-import-v1",
		},
		200,
		request,
	);
}

function findSameEnergyImageId(rawText) {
	const candidates = [];

	for (const rawLine of String(rawText || "").split(/\r?\n/)) {
		const line = rawLine.trim();

		if (!line) {
			continue;
		}

		try {
			candidates.push(JSON.parse(line));
		} catch {
			// Ignore non-JSON streaming frames.
		}
	}

	if (candidates.length === 0) {
		try {
			candidates.push(JSON.parse(rawText));
		} catch {
			return null;
		}
	}

	for (const candidate of candidates) {
		const found = findStringByKeys(
			candidate,
			new Set([
				"id",
				"image_id",
				"imageId",
				"sha1",
			]),
		);

		if (found) {
			return found;
		}
	}

	return null;
}

function findStringByKeys(value, keys) {
	if (!value || typeof value !== "object") {
		return null;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findStringByKeys(item, keys);

			if (found) {
				return found;
			}
		}

		return null;
	}

	for (const [key, nestedValue] of Object.entries(value)) {
		if (
			keys.has(key) &&
			typeof nestedValue === "string" &&
			nestedValue.trim()
		) {
			return nestedValue.trim();
		}
	}

	for (const nestedValue of Object.values(value)) {
		const found = findStringByKeys(
			nestedValue,
			keys,
		);

		if (found) {
			return found;
		}
	}

	return null;
}

async function handleBaiduSearch(request, env) {
	const unauthorized = authorizeRequest(request, env);

	if (unauthorized) {
		return unauthorized;
	}

	const contentType = normalizeContentType(
		request.headers.get("Content-Type"),
	);

	const imageMode =
		request.headers.get("X-RISE-Image-Mode") || "";

	let result;

	if (
		imageMode === "file" ||
		contentType.startsWith("image/")
	) {
		if (!IMAGE_TYPES.has(contentType)) {
			return jsonResponse(
				{
					error:
						`Baidu does not support the supplied image type: ${contentType || "unknown"}.`,
				},
				415,
				request,
			);
		}

		const contentLength = Number(
			request.headers.get("Content-Length") || 0,
		);

		if (
			contentLength &&
			contentLength > MAX_UPLOAD_BYTES
		) {
			return jsonResponse(
				{
					error: "The image is too large for Baidu.",
				},
				413,
				request,
			);
		}

		const bytes = await request.arrayBuffer();

		if (
			bytes.byteLength <= 0 ||
			bytes.byteLength > MAX_UPLOAD_BYTES
		) {
			return jsonResponse(
				{
					error: "The image size is not supported by Baidu.",
				},
				400,
				request,
			);
		}

		result = await submitBaiduBinary(
			bytes,
			contentType,
		);
	} else {
		let body;

		try {
			body = await request.json();
		} catch {
			return jsonResponse(
				{
					error:
						"The Baidu search request did not contain an image file or valid JSON.",
				},
				400,
				request,
			);
		}

		const imageUrl = normalizePublicImageUrl(
			body?.imageUrl,
		);

		if (!imageUrl) {
			return jsonResponse(
				{
					error: "Baidu did not receive a valid image URL.",
				},
				400,
				request,
			);
		}

		result = await submitBaiduImageUrl(imageUrl);

		if (!result.url) {
			result = await submitBaiduImageFile(
				imageUrl,
				env,
				request.url,
			);
		}
	}

	if (!result?.url) {
		console.error(
			"Baidu search failure:",
			result,
		);

		return jsonResponse(
			{
				error:
					result?.error ||
					"Baidu rejected the image search request.",
			},
			502,
			request,
		);
	}

	return jsonResponse(
		{
			url: result.url,
			engine: "baidu",
			build: "stable-18-url-import-v1",
		},
		200,
		request,
	);
}

async function submitBaiduImageUrl(imageUrl) {
	const form = new URLSearchParams({
		image: imageUrl,
		tn: "pc",
		from: "pc",
		image_source: "PC_UPLOAD_URL",
	});

	const attempt = await sendBaiduRequest(
		form,
		{
			"Content-Type":
				"application/x-www-form-urlencoded;charset=UTF-8",
		},
	);

	if (attempt.url) {
		return attempt;
	}

	return {
		url: null,
		urlAttempt: attempt,
	};
}

async function submitBaiduBinary(
	bytes,
	contentType,
) {
	const extension =
		IMAGE_TYPES.get(contentType) || "jpg";

	const form = new FormData();

	form.append("tn", "pc");
	form.append("from", "pc");
	form.append("image_source", "PC_UPLOAD_SEARCH_FILE");
	form.append(
		"range",
		JSON.stringify({
			page_from: "searchIndex",
		}),
	);
	form.append(
		"image",
		new Blob(
			[bytes],
			{
				type: contentType,
			},
		),
		`rise-image.${extension}`,
	);

	const attempt = await sendBaiduRequest(form);

	if (attempt.url) {
		return attempt;
	}

	return {
		url: null,
		error:
			attempt.error ||
			"Baidu rejected the directly submitted image file.",
		fileAttempt: attempt,
	};
}

async function submitBaiduImageFile(
	imageUrl,
	env,
	requestUrl,
) {
	let bytes;
	let contentType;
	let extension;

	const localImage =
		await readLocalRiseImage(
			imageUrl,
			env,
			requestUrl,
		);

	if (localImage) {
		bytes = localImage.bytes;
		contentType = localImage.contentType;
		extension = localImage.extension;
	} else {
		let imageResponse;

		try {
			imageResponse = await fetch(imageUrl, {
				redirect: "follow",
			});
		} catch (error) {
			return {
				url: null,
				error:
					"Baidu could not download the image URL.",
				fileAttempt: String(error),
			};
		}

		if (!imageResponse.ok) {
			return {
				url: null,
				error:
					`The image URL returned status ${imageResponse.status}.`,
			};
		}

		contentType = normalizeContentType(
			imageResponse.headers.get("Content-Type"),
		);

		extension =
			IMAGE_TYPES.get(contentType) || "jpg";

		const contentLength = Number(
			imageResponse.headers.get("Content-Length") || 0,
		);

		if (
			contentLength &&
			contentLength > MAX_UPLOAD_BYTES
		) {
			return {
				url: null,
				error: "The image is too large for Baidu.",
			};
		}

		bytes = await imageResponse.arrayBuffer();
	}

	if (
		!bytes ||
		bytes.byteLength <= 0 ||
		bytes.byteLength > MAX_UPLOAD_BYTES
	) {
		return {
			url: null,
			error: "The image size is not supported by Baidu.",
		};
	}

	const form = new FormData();

	form.append("tn", "pc");
	form.append("from", "pc");
	form.append("image_source", "PC_UPLOAD_SEARCH_FILE");
	form.append(
		"range",
		JSON.stringify({
			page_from: "searchIndex",
		}),
	);
	form.append(
		"image",
		new Blob(
			[bytes],
			{
				type: contentType || "image/jpeg",
			},
		),
		`rise-image.${extension || "jpg"}`,
	);

	const attempt = await sendBaiduRequest(form);

	if (attempt.url) {
		return attempt;
	}

	return {
		url: null,
		error:
			attempt.error ||
			"Baidu rejected both URL and file search methods.",
		fileAttempt: attempt,
	};
}

async function readLocalRiseImage(
	imageUrl,
	env,
	requestUrl,
) {
	let parsedImageUrl;
	let workerOrigin;

	try {
		parsedImageUrl = new URL(imageUrl);
		workerOrigin = new URL(requestUrl).origin;
	} catch {
		return null;
	}

	if (
		parsedImageUrl.origin !== workerOrigin ||
		!parsedImageUrl.pathname.startsWith("/i/")
	) {
		return null;
	}

	const filename = decodeURIComponent(
		parsedImageUrl.pathname.slice("/i/".length),
	);

	if (
		!/^[a-f0-9]{32}\.(?:jpg|png|webp|gif|avif|heic|heif|bmp|tiff)$/i.test(
			filename,
		)
	) {
		return null;
	}

	const object = await env.rise_temp_images.get(
		`uploads/${filename}`,
	);

	if (!object) {
		return null;
	}

	const contentType =
		normalizeContentType(
			object.httpMetadata?.contentType,
		) || "image/jpeg";

	const extension =
		IMAGE_TYPES.get(contentType) ||
		filename.split(".").pop().toLowerCase() ||
		"jpg";

	return {
		bytes: await object.arrayBuffer(),
		contentType,
		extension,
	};
}

async function sendBaiduRequest(body, extraHeaders = {}) {
	const endpoint =
		`https://graph.baidu.com/upload?uptime=${Date.now()}`;

	let response;

	try {
		response = await fetch(
			endpoint,
			{
				method: "POST",

				headers: {
					Accept:
						"application/json, text/plain, */*",
					"Acs-Token": "",
					Origin: "https://graph.baidu.com",
					Referer:
						"https://graph.baidu.com/pcpage/index?tpl_from=pc",
					...extraHeaders,
				},

				body,
				redirect: "follow",
			},
		);
	} catch (error) {
		return {
			url: null,
			error: String(error),
		};
	}

	const responseText = await response.text();

	let payload;

	try {
		payload = JSON.parse(responseText);
	} catch {
		return {
			url: null,
			httpStatus: response.status,
			error: "Baidu returned an unreadable response.",
		};
	}

	const resultsUrl = payload?.data?.url;

	if (
		response.ok &&
		typeof resultsUrl === "string" &&
		resultsUrl.startsWith("https://graph.baidu.com/")
	) {
		return {
			url: resultsUrl,
			status: payload.status,
		};
	}

	return {
		url: null,
		httpStatus: response.status,
		status: payload?.status,
		message: payload?.msg || null,
	};
}

function authorizeRequest(request, env) {
	const configuredToken =
		typeof env.RISE_UPLOAD_TOKEN === "string"
			? env.RISE_UPLOAD_TOKEN
			: "";

	const authorization =
		request.headers.get("Authorization") || "";

	const suppliedToken =
		authorization.startsWith("Bearer ")
			? authorization.slice("Bearer ".length)
			: "";

	if (
		!configuredToken ||
		!constantTimeEqual(
			suppliedToken,
			configuredToken,
		)
	) {
		return jsonResponse(
			{
				error: "Unauthorized.",
			},
			401,
			request,
		);
	}

	return null;
}

function constantTimeEqual(left, right) {
	const maxLength = Math.max(
		left.length,
		right.length,
	);

	let difference = left.length ^ right.length;

	for (let index = 0; index < maxLength; index += 1) {
		difference |=
			(left.charCodeAt(index) || 0) ^
			(right.charCodeAt(index) || 0);
	}

	return difference === 0;
}

function normalizeContentType(rawContentType) {
	return String(rawContentType || "")
		.split(";")[0]
		.trim()
		.toLowerCase();
}

function normalizePublicImageUrl(rawUrl) {
	if (typeof rawUrl !== "string") {
		return null;
	}

	try {
		const url = new URL(rawUrl.trim());

		if (
			url.protocol !== "http:" &&
			url.protocol !== "https:"
		) {
			return null;
		}

		return url.href;
	} catch {
		return null;
	}
}

function corsHeaders(request) {
	const origin =
		request.headers.get("Origin") || "*";

	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods":
			"GET, HEAD, POST, OPTIONS",
		"Access-Control-Allow-Headers":
			"Authorization, Content-Type, X-RISE-Image-Mode",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
}

function jsonResponse(data, status, request) {
	return new Response(
		JSON.stringify(data, null, 2),
		{
			status,

			headers: {
				"Content-Type":
					"application/json; charset=utf-8",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
				...corsHeaders(request),
			},
		},
	);
}
