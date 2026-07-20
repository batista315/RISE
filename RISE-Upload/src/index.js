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
						build: "stable-17-imgops-same-energy-v1",
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
			build: "stable-17-imgops-same-energy-v1",
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
			build: "stable-17-imgops-same-energy-v1",
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
