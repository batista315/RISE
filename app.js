"use strict";

const WORKER_BASE_URL =
	"https://rise-upload.cloudflare-3cb-e40.workers.dev";

const CLIENT_UPLOAD_LIMIT_BYTES = 95_000_000;

const STORAGE_KEYS = {
	theme: "rise-theme",
	engine: "rise-engine",
	token: "rise-upload-token",
};

const SUPPORTED_IMAGE_TYPES = new Map([
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

const EXTENSION_TO_MIME = new Map([
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["png", "image/png"],
	["webp", "image/webp"],
	["gif", "image/gif"],
	["avif", "image/avif"],
	["heic", "image/heic"],
	["heif", "image/heif"],
	["bmp", "image/bmp"],
	["tif", "image/tiff"],
	["tiff", "image/tiff"],
]);

const ENGINE_ADAPTERS = {
	google: {
		name: "Google",
		buildUrl(imageUrl) {
			return (
				"https://lens.google.com/uploadbyurl?url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},


	kagi: {
		name: "Kagi",
		filePost: {
			action: "https://kagi.com/reverse/upload",
			fieldName: "file",
		},
	},

	bing: {
		name: "Bing",
		buildUrl(imageUrl) {
			return (
				"https://www.bing.com/images/search" +
				"?q=imgurl:" + encodeURIComponent(imageUrl) +
				"&view=detailv2" +
				"&iss=sbi" +
				"&FORM=IRSBIQ" +
				"&redirecturl=https%3A%2F%2Fwww.bing.com%2Fimages%2Fdiscover%3Fform%3DHDRSC2" +
				"#enterInsights"
			);
		},
	},




	yandex: {
		name: "Yandex",
		buildUrl(imageUrl) {
			return (
				"https://yandex.com/images/search?rpt=imageview&url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

	baidu: {
		name: "Baidu",
		workerSearch: "baidu",
	},


	tineye: {
		name: "TinEye",
		buildUrl(imageUrl) {
			return (
				"https://tineye.com/search?url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

	imgops: {
		name: "ImgOps",
		buildUrl(imageUrl) {
			return "https://imgops.com/" + imageUrl;
		},
	},


	saucenao: {
		name: "SauceNAO",
		buildUrl(imageUrl) {
			return (
				"https://saucenao.com/search.php?db=999&url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

	"trace-moe": {
		name: "trace.moe",
		buildUrl(imageUrl) {
			return (
				"https://trace.moe/?url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},


	iqdb: {
		name: "IQDB",
		buildUrl(imageUrl) {
			return (
				"https://iqdb.org/?url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

	"iqdb-3d": {
		name: "3D IQDB",
		buildUrl(imageUrl) {
			return (
				"https://3d.iqdb.org/?url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

	"iqdb-idol": {
		name: "Idol Complex",
		buildUrl(imageUrl) {
			return (
				"https://idol.iqdb.org/?url=" +
				encodeURIComponent(imageUrl)
			);
		},
	},


	ascii2d: {
		name: "ascii2d",
		buildUrl(imageUrl) {
			return (
				"https://ascii2d.net/search/url/" +
				imageUrl
			);
		},
	},

	artresearch: {
		name: "ArtResearch.net",
		buildUrl(imageUrl) {
			return (
				"https://artresearch.net/resource/search?query=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

	lenso: {
		name: "lenso.ai",
		buildUrl(imageUrl) {
			return (
				"https://lenso.ai/en/search-by-url?url=" +
				encodeURIComponent(imageUrl) +
				"&utm_source=rise"
			);
		},
	},


	"same-energy": {
		name: "Same Energy",
		workerSearch: "same-energy",
	},


	lexica: {
		name: "Lexica",
		buildUrl(imageUrl) {
			return (
				"https://lexica.art/?q=" +
				encodeURIComponent(imageUrl)
			);
		},
	},

};

const elements = {
	root: document.documentElement,
	themeColor: document.querySelector('meta[name="theme-color"]'),
	themeToggle: document.querySelector("#theme-toggle"),

	emptyState: document.querySelector("#empty-state"),
	loadedState: document.querySelector("#loaded-state"),
	dropZone: document.querySelector("#drop-zone"),
	uploadButton: document.querySelector("#upload-button"),
	pasteImageButton: document.querySelector("#paste-image-button"),
	fileInput: document.querySelector("#file-input"),

	urlForm: document.querySelector("#url-form"),
	imageUrlInput: document.querySelector("#image-url"),

	imagePreview: document.querySelector("#image-preview"),
	showResultsButton: document.querySelector("#show-results-button"),
	resetButton: document.querySelector("#reset-button"),

	engineSelect: document.querySelector("#engine-select"),
	engineChips: [
		...document.querySelectorAll(".engine-chip"),
	],

	statusMessage: document.querySelector("#status-message"),
};

const state = {
	token: null,

	file: null,
	mimeType: null,
	previewUrl: null,

	sourceUrl: null,
	publicUrl: null,

	isUploading: false,
	resetArmed: false,
	resetTimer: null,

};

function safeStorageGet(storage, key) {
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function safeStorageSet(storage, key, value) {
	try {
		storage.setItem(key, value);
	} catch {
		// Some private-browsing configurations reject storage writes.
	}
}

function safeStorageRemove(storage, key) {
	try {
		storage.removeItem(key);
	} catch {
		// Ignore storage failures.
	}
}

function setStatus(message = "", type = "") {
	elements.statusMessage.textContent = message;

	elements.statusMessage.classList.remove(
		"is-error",
		"is-success",
	);

	if (type === "error") {
		elements.statusMessage.classList.add("is-error");
	}

	if (type === "success") {
		elements.statusMessage.classList.add("is-success");
	}
}

function setActionsEnabled(enabled) {
	elements.showResultsButton.disabled = !enabled;

	for (const chip of elements.engineChips) {
		chip.disabled = !enabled;
	}
}

function initializeToken() {
	const rawHash = window.location.hash.slice(1);
	const hashParameters = new URLSearchParams(rawHash);

	const tokenCandidate =
		hashParameters.get("token") || rawHash;

	const hashToken = tokenCandidate
		.trim()
		.replace(/^["']+|["']+$/g, "");

	if (hashToken) {
		state.token = hashToken;

		safeStorageSet(
			sessionStorage,
			STORAGE_KEYS.token,
			state.token,
		);

		history.replaceState(
			null,
			document.title,
			window.location.pathname + window.location.search,
		);

		return;
	}

	const storedToken = safeStorageGet(
		sessionStorage,
		STORAGE_KEYS.token,
	);

	if (storedToken?.trim()) {
		state.token = storedToken.trim();
	}
}

function initializeTheme() {
	const storedTheme = safeStorageGet(
		localStorage,
		STORAGE_KEYS.theme,
	);

	const theme =
		storedTheme === "light" || storedTheme === "dark"
			? storedTheme
			: "dark";

	applyTheme(theme);
}

function applyTheme(theme) {
	elements.root.dataset.theme = theme;

	safeStorageSet(
		localStorage,
		STORAGE_KEYS.theme,
		theme,
	);

	const isDark = theme === "dark";

	elements.themeToggle.setAttribute(
		"aria-label",
		isDark
			? "Switch to light mode"
			: "Switch to dark mode",
	);

	elements.themeColor?.setAttribute(
		"content",
		isDark ? "#090d14" : "#f4f6fb",
	);
}

function initializeEngine() {
	const storedEngine = safeStorageGet(
		localStorage,
		STORAGE_KEYS.engine,
	);

	if (
		storedEngine &&
		ENGINE_ADAPTERS[storedEngine] &&
		[
			...elements.engineSelect.options,
		].some((option) => option.value === storedEngine)
	) {
		elements.engineSelect.value = storedEngine;
	}
}

function inferMimeType(file) {
	const suppliedType = file.type
		?.split(";")[0]
		.trim()
		.toLowerCase();

	if (SUPPORTED_IMAGE_TYPES.has(suppliedType)) {
		return suppliedType;
	}

	const extension = file.name
		.split(".")
		.pop()
		?.toLowerCase();

	return EXTENSION_TO_MIME.get(extension) || null;
}

function formatFileSize(bytes) {
	const megabytes = bytes / 1_000_000;

	if (megabytes >= 10) {
		return `${megabytes.toFixed(1)} MB`;
	}

	return `${megabytes.toFixed(2)} MB`;
}

function validateFile(file) {
	if (!(file instanceof Blob)) {
		throw new Error("That does not appear to be a valid image.");
	}

	if (file.size <= 0) {
		throw new Error("The selected image is empty.");
	}

	if (file.size > CLIENT_UPLOAD_LIMIT_BYTES) {
		throw new Error(
			`That image is ${formatFileSize(file.size)}. ` +
			"The maximum displayed upload limit is 95 MB.",
		);
	}

	const mimeType = inferMimeType(file);

	if (!mimeType) {
		throw new Error(
			"That image type is not supported by RISE.",
		);
	}

	return mimeType;
}

function revokePreviewUrl() {
	if (
		state.previewUrl &&
		state.previewUrl.startsWith("blob:")
	) {
		URL.revokeObjectURL(state.previewUrl);
	}

	state.previewUrl = null;
}

function showLoadedState(previewUrl) {
	elements.imagePreview.src = previewUrl;

	elements.emptyState.hidden = true;
	elements.loadedState.hidden = false;

	window.scrollTo({
		top: 0,
		behavior: "smooth",
	});
}

function resetResetButton() {
	state.resetArmed = false;

	clearTimeout(state.resetTimer);
	state.resetTimer = null;

	elements.resetButton.classList.remove("is-armed");
	elements.resetButton.textContent = "Search New Image";
}

function clearCurrentImage() {
	revokePreviewUrl();
	resetResetButton();

	state.file = null;
	state.mimeType = null;
	state.sourceUrl = null;
	state.publicUrl = null;
	state.isUploading = false;

	elements.fileInput.value = "";
	elements.imageUrlInput.value = "";
	elements.imagePreview.removeAttribute("src");

	elements.loadedState.hidden = true;
	elements.emptyState.hidden = false;

	setActionsEnabled(false);
	setStatus("");
}

async function uploadFileToWorker(file, mimeType) {
	if (!state.token) {
		throw new Error(
			"RISE does not have your private upload token. " +
			"Open RISE from your private bookmark.",
		);
	}

	const response = await fetch(
		`${WORKER_BASE_URL}/upload`,
		{
			method: "POST",

			headers: {
				Authorization: `Bearer ${state.token}`,
				"Content-Type": mimeType,
			},

			body: file,
		},
	);

	const responseText = await response.text();

	let responseData;

	try {
		responseData = JSON.parse(responseText);
	} catch {
		responseData = null;
	}

	if (!response.ok) {
		const serverMessage =
			responseData?.error ||
			`Upload failed with status ${response.status}.`;

		if (response.status === 401) {
			safeStorageRemove(
				sessionStorage,
				STORAGE_KEYS.token,
			);

			state.token = null;

			throw new Error(
				"RISE rejected the upload token. " +
				"Open the private bookmark again.",
			);
		}

		throw new Error(serverMessage);
	}

	if (
		!responseData?.url ||
		typeof responseData.url !== "string"
	) {
		throw new Error(
			"The upload completed, but RISE did not receive an image URL.",
		);
	}

	return responseData.url;
}

async function loadLocalImage(file) {
	let mimeType;

	try {
		mimeType = validateFile(file);
	} catch (error) {
		setStatus(error.message, "error");
		return;
	}

	revokePreviewUrl();

	state.file = file;
	state.mimeType = mimeType;
	state.sourceUrl = null;
	state.publicUrl = null;
	state.previewUrl = URL.createObjectURL(file);
	state.isUploading = true;

	showLoadedState(state.previewUrl);
	setActionsEnabled(false);

	setStatus(
		`Uploading ${formatFileSize(file.size)} image…`,
	);

	try {
		state.publicUrl = await uploadFileToWorker(
			file,
			mimeType,
		);

		state.isUploading = false;
		setActionsEnabled(true);

		setStatus(
			"Image ready. It will automatically expire from RISE storage.",
			"success",
		);
	} catch (error) {
		state.isUploading = false;
		setActionsEnabled(false);

		setStatus(
			error instanceof Error
				? error.message
				: "The image could not be uploaded.",
			"error",
		);
	}
}

function loadImageUrl(rawUrl) {
	let parsedUrl;

	try {
		parsedUrl = new URL(rawUrl.trim());
	} catch {
		setStatus(
			"Enter a complete image URL beginning with http:// or https://.",
			"error",
		);
		return;
	}

	if (
		parsedUrl.protocol !== "http:" &&
		parsedUrl.protocol !== "https:"
	) {
		setStatus(
			"Only http:// and https:// image URLs are supported.",
			"error",
		);
		return;
	}

	revokePreviewUrl();

	state.file = null;
	state.mimeType = null;
	state.sourceUrl = parsedUrl.href;
	state.publicUrl = parsedUrl.href;
	state.previewUrl = parsedUrl.href;
	state.isUploading = false;

	showLoadedState(parsedUrl.href);
	setActionsEnabled(true);

	setStatus(
		"Image URL ready.",
		"success",
	);
}

function getCurrentSearchableUrl() {
	return state.publicUrl || state.sourceUrl || null;
}

function openFilePostEngine(adapter) {
	if (!(state.file instanceof Blob)) {
		setStatus(
			`${adapter.name} needs the original uploaded or pasted image file. ` +
				"Use Upload Image or Paste Image instead of Paste Image URL.",
			"error",
		);

		return;
	}

	if (typeof DataTransfer !== "function") {
		setStatus(
			`${adapter.name} file submission is not supported by this browser.`,
			"error",
		);

		return;
	}

	const targetName =
		`rise-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	const resultWindow = window.open(
		"",
		targetName,
	);

	if (!resultWindow) {
		setStatus(
			"The browser blocked the results tab. Allow pop-ups for RISE and try again.",
			"error",
		);

		return;
	}

	const form = document.createElement("form");
	const input = document.createElement("input");

	form.method = "POST";
	form.action = adapter.filePost.action;
	form.enctype = "multipart/form-data";
	form.target = targetName;
	form.hidden = true;

	input.type = "file";
	input.name = adapter.filePost.fieldName;

	form.append(input);
	document.body.append(form);

	try {
		const transfer = new DataTransfer();
		transfer.items.add(state.file);
		input.files = transfer.files;

		if (!input.files || input.files.length !== 1) {
			throw new Error(
				"The browser refused to attach the image file.",
			);
		}

		form.submit();

		setStatus(
			`Submitted the image to ${adapter.name}.`,
			"success",
		);
	} catch (error) {
		try {
			resultWindow.close();
		} catch {
			// Ignore close failures.
		}

		setStatus(
			error instanceof Error
				? `${adapter.name}: ${error.message}`
				: `${adapter.name} could not receive the image.`,
			"error",
		);
	} finally {
		window.setTimeout(() => {
			form.remove();
		}, 1000);
	}
}

async function openWorkerSearchEngine(adapter, imageUrl) {
	if (!state.token) {
		setStatus(
			"RISE does not have your private upload token. Open RISE from your private bookmark.",
			"error",
		);

		return;
	}

	const resultWindow = window.open(
		"",
		"_blank",
	);

	if (!resultWindow) {
		setStatus(
			"The browser blocked the results tab. Allow pop-ups for RISE and try again.",
			"error",
		);

		return;
	}

	try {
		resultWindow.document.title =
			`Opening ${adapter.name}…`;

		resultWindow.document.body.innerHTML =
			'<p style="font:16px system-ui;padding:24px">Preparing image search…</p>';
	} catch {
		// The temporary blank tab can still be navigated.
	}

	setStatus(
		`Preparing ${adapter.name}…`,
	);

	try {
		const headers = {
			Authorization: `Bearer ${state.token}`,
		};

		let body;

		if (
			["baidu", "same-energy"].includes(adapter.workerSearch) &&
			state.file instanceof Blob
		) {
			headers["Content-Type"] =
				state.mimeType ||
				state.file.type ||
				"application/octet-stream";

			headers["X-RISE-Image-Mode"] = "file";
			body = state.file;
		} else {
			headers["Content-Type"] = "application/json";
			headers["X-RISE-Image-Mode"] = "url";

			body = JSON.stringify({
				imageUrl,
			});
		}

		const response = await fetch(
			`${WORKER_BASE_URL}/search/${adapter.workerSearch}`,
			{
				method: "POST",
				headers,
				body,
			},
		);

		const responseText = await response.text();

		let responseData;

		try {
			responseData = JSON.parse(responseText);
		} catch {
			responseData = null;
		}

		if (!response.ok) {
			if (response.status === 401) {
				safeStorageRemove(
					sessionStorage,
					STORAGE_KEYS.token,
				);

				state.token = null;
			}

			throw new Error(
				responseData?.error ||
					`${adapter.name} failed with status ${response.status}.`,
			);
		}

		if (
			!responseData?.url ||
			typeof responseData.url !== "string"
		) {
			throw new Error(
				`${adapter.name} did not return a results URL.`,
			);
		}

		resultWindow.location.replace(responseData.url);

		setStatus(
			`Opened ${adapter.name} in a new tab.`,
			"success",
		);
	} catch (error) {
		try {
			resultWindow.close();
		} catch {
			// Ignore close failures.
		}

		setStatus(
			error instanceof Error
				? error.message
				: `${adapter.name} could not complete the search.`,
			"error",
		);
	}
}

function openEngine(engineId) {
	const imageUrl = getCurrentSearchableUrl();

	if (!imageUrl) {
		setStatus(
			state.isUploading
				? "Wait for the image upload to finish."
				: "Choose an image first.",
			"error",
		);

		return;
	}

	const adapter = ENGINE_ADAPTERS[engineId];

	if (!adapter) {
		setStatus(
			"That search engine is not recognized.",
			"error",
		);

		return;
	}

	if (adapter.filePost) {
		openFilePostEngine(adapter);
		return;
	}

	if (adapter.workerSearch) {
		void openWorkerSearchEngine(adapter, imageUrl);
		return;
	}

	if (typeof adapter.buildUrl !== "function") {
		setStatus(
			`${adapter.name} is not configured correctly.`,
			"error",
		);

		return;
	}

	const destination = adapter.buildUrl(imageUrl);

	const resultWindow = window.open(
		destination,
		"_blank",
	);

	if (!resultWindow) {
		setStatus(
			"The browser blocked the results tab. Allow pop-ups for RISE and try again.",
			"error",
		);

		return;
	}

	try {
		resultWindow.opener = null;
	} catch {
		// Some browsers do not allow this assignment.
	}

	setStatus(
		`Opened ${adapter.name} in a new tab.`,
		"success",
	);
}

async function dataUrlToFile(dataUrl) {
	const response = await fetch(dataUrl);
	const blob = await response.blob();

	const extension =
		SUPPORTED_IMAGE_TYPES.get(blob.type) ||
		"png";

	return new File(
		[blob],
		`pasted-image.${extension}`,
		{
			type: blob.type || "image/png",
			lastModified: Date.now(),
		},
	);
}

async function loadClipboardTextUrl(rawText) {
	const text = rawText.trim();

	if (!text) {
		return false;
	}

	try {
		const parsedUrl = new URL(text);

		if (
			parsedUrl.protocol !== "http:" &&
			parsedUrl.protocol !== "https:"
		) {
			return false;
		}

		loadImageUrl(parsedUrl.href);
		return true;
	} catch {
		return false;
	}
}

async function pasteImageFromClipboard() {
	if (
		!navigator.clipboard ||
		typeof navigator.clipboard.read !== "function"
	) {
		setStatus(
			"Direct image paste is not available in this browser. Use Upload Image instead.",
			"error",
		);
		return;
	}

	const pasteButtonRect =
		elements.pasteImageButton.getBoundingClientRect();

	const pasteCatcher = document.createElement("div");

	pasteCatcher.contentEditable = "true";
	pasteCatcher.tabIndex = -1;
	pasteCatcher.setAttribute("inputmode", "none");
	pasteCatcher.setAttribute("aria-hidden", "true");
	pasteCatcher.setAttribute("autocapitalize", "off");
	pasteCatcher.setAttribute("autocomplete", "off");
	pasteCatcher.setAttribute("spellcheck", "false");

	Object.assign(pasteCatcher.style, {
		position: "fixed",
		left: `${pasteButtonRect.left + pasteButtonRect.width / 2}px`,
		top: `${pasteButtonRect.top + pasteButtonRect.height / 2}px`,
		width: "2px",
		height: "2px",
		padding: "0",
		margin: "0",
		border: "0",
		outline: "0",
		opacity: "0.01",
		overflow: "hidden",
		color: "transparent",
		caretColor: "transparent",
		background: "transparent",
		pointerEvents: "none",
		zIndex: "2147483647",
	});

	document.body.append(pasteCatcher);

	let completed = false;
	let resolveCapturedPaste;

	const capturedPaste = new Promise((resolve) => {
		resolveCapturedPaste = resolve;
	});

	function cleanupPasteCatcher() {
		window.setTimeout(() => {
			pasteObserver.disconnect();
			pasteCatcher.remove();
		}, 0);
	}

	function completePaste() {
		if (completed) {
			return false;
		}

		completed = true;
		resolveCapturedPaste(true);
		cleanupPasteCatcher();
		return true;
	}

	function extensionForMimeType(mimeType) {
		return (
			SUPPORTED_IMAGE_TYPES.get(
				mimeType
					.split(";")[0]
					.trim()
					.toLowerCase(),
			) || "png"
		);
	}

	async function loadBlobAsImage(
		blob,
		typeHint = "",
	) {
		const mimeType = (
			blob.type ||
			typeHint ||
			""
		)
			.split(";")[0]
			.trim()
			.toLowerCase();

		if (
			!blob.size ||
			!mimeType.startsWith("image/")
		) {
			return false;
		}

		if (!completePaste()) {
			return true;
		}

		await loadLocalImage(
			new File(
				[blob],
				`pasted-image.${extensionForMimeType(
					mimeType,
				)}`,
				{
					type: mimeType,
					lastModified: Date.now(),
				},
			),
		);

		return true;
	}

	async function loadPastedSource(rawSource) {
		const source = rawSource
			?.trim()
			.replace(/^["']+|["']+$/g, "");

		if (!source) {
			return false;
		}

		if (
			source.startsWith("data:image/") ||
			source.startsWith("blob:")
		) {
			try {
				const response = await fetch(source);
				const blob = await response.blob();

				return loadBlobAsImage(blob);
			} catch {
				return false;
			}
		}

		if (/^https?:\/\//i.test(source)) {
			if (!completePaste()) {
				return true;
			}

			loadImageUrl(source);
			return true;
		}

		return false;
	}

	async function inspectHtml(html) {
		if (!html?.trim()) {
			return false;
		}

		const parsed =
			new DOMParser().parseFromString(
				html,
				"text/html",
			);

		const imageSources = [
			...parsed.querySelectorAll(
				"img[src], source[src], source[srcset]",
			),
		].flatMap((element) => {
			const sources = [];
			const src = element.getAttribute("src");
			const srcset =
				element.getAttribute("srcset");

			if (src) {
				sources.push(src);
			}

			if (srcset) {
				sources.push(
					...srcset
						.split(",")
						.map((candidate) =>
							candidate
								.trim()
								.split(/\s+/)[0],
						),
				);
			}

			return sources;
		});

		for (const source of imageSources) {
			if (await loadPastedSource(source)) {
				return true;
			}
		}

		return loadPastedSource(
			parsed.body?.textContent || "",
		);
	}

	async function inspectDataTransfer(dataTransfer) {
		if (!dataTransfer) {
			return false;
		}

		const files = [
			...(dataTransfer.files || []),
		];

		for (const file of files) {
			if (
				file.type.startsWith("image/") &&
				await loadBlobAsImage(file, file.type)
			) {
				return true;
			}
		}

		const items = [
			...(dataTransfer.items || []),
		];

		for (const item of items) {
			if (!item.type.startsWith("image/")) {
				continue;
			}

			const file = item.getAsFile();

			if (
				file &&
				await loadBlobAsImage(file, item.type)
			) {
				return true;
			}
		}

		const html =
			dataTransfer.getData?.("text/html");

		if (html && await inspectHtml(html)) {
			return true;
		}

		const text =
			dataTransfer.getData?.("text/uri-list") ||
			dataTransfer.getData?.("text/plain");

		return loadPastedSource(text);
	}

	async function inspectInsertedContent() {
		if (completed) {
			return true;
		}

		const imageSource =
			pasteCatcher.querySelector("img")
				?.getAttribute("src");

		if (await loadPastedSource(imageSource)) {
			return true;
		}

		const html = pasteCatcher.innerHTML;

		if (
			html &&
			html !== "<br>" &&
			await inspectHtml(html)
		) {
			return true;
		}

		return loadPastedSource(
			pasteCatcher.textContent || "",
		);
	}

	pasteCatcher.addEventListener(
		"paste",
		(event) => {
			event.stopImmediatePropagation();

			void inspectDataTransfer(
				event.clipboardData,
			).then((loaded) => {
				if (loaded) {
					event.preventDefault();
					return;
				}

				window.setTimeout(
					() => {
						void inspectInsertedContent();
					},
					0,
				);
			});
		},
		true,
	);

	pasteCatcher.addEventListener(
		"beforeinput",
		(event) => {
			if (
				event.inputType !== "insertFromPaste"
			) {
				return;
			}

			event.stopImmediatePropagation();

			void inspectDataTransfer(
				event.dataTransfer,
			).then((loaded) => {
				if (loaded) {
					event.preventDefault();
					return;
				}

				window.setTimeout(
					() => {
						void inspectInsertedContent();
					},
					0,
				);
			});
		},
		true,
	);

	pasteCatcher.addEventListener(
		"input",
		() => {
			window.setTimeout(
				() => {
					void inspectInsertedContent();
				},
				0,
			);
		},
	);

	const pasteObserver = new MutationObserver(() => {
		window.setTimeout(
			() => {
				void inspectInsertedContent();
			},
			0,
		);
	});

	pasteObserver.observe(
		pasteCatcher,
		{
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["src", "srcset"],
		},
	);

	pasteCatcher.focus({
		preventScroll: true,
	});

	try {
		const selection = window.getSelection();
		const range = document.createRange();

		range.selectNodeContents(pasteCatcher);
		range.collapse(false);

		selection.removeAllRanges();
		selection.addRange(range);
	} catch {
		// Focus is enough if Safari rejects selection manipulation.
	}

	const observedTypes = new Set();

	try {
		/*
		 * Safari shows its small native Paste callout for this read.
		 * If ClipboardItem[] is empty, the focused hidden editable target
		 * still gives WebKit a place to insert the pasted image as a file,
		 * DataTransfer item, or blob-backed <img>.
		 */
		const clipboardItems =
			await navigator.clipboard.read();

		for (const clipboardItem of clipboardItems) {
			const itemTypes =
				Array.from(
					clipboardItem.types || [],
				);

			for (const type of itemTypes) {
				observedTypes.add(type);
			}

			for (const type of itemTypes) {
				try {
					const blob =
						await clipboardItem.getType(type);

					if (
						await loadBlobAsImage(
							blob,
							type,
						)
					) {
						return;
					}

					if (type === "text/html") {
						if (
							await inspectHtml(
								await blob.text(),
							)
						) {
							return;
						}
					}

					if (
						type === "text/plain" ||
						type === "text/uri-list"
					) {
						if (
							await loadPastedSource(
								await blob.text(),
							)
						) {
							return;
						}
					}
				} catch {
					// Continue through other clipboard formats.
				}
			}
		}

		/*
		 * On affected iOS Safari builds, read() resolves with an empty array.
		 * Give the real paste event/default DOM insertion time to arrive.
		 */
		const inserted = await Promise.race([
			capturedPaste,
			new Promise((resolve) => {
				window.setTimeout(
					() => resolve(false),
					1200,
				);
			}),
		]);

		if (inserted || completed) {
			return;
		}

		if (await inspectInsertedContent()) {
			return;
		}

		const formats =
			[...observedTypes].join(", ") ||
			"none reported";

		setStatus(
			`Safari granted paste access but exposed no usable image data (${formats}).`,
			"error",
		);

		cleanupPasteCatcher();
	} catch (error) {
		cleanupPasteCatcher();

		if (
			error instanceof DOMException &&
			error.name === "NotAllowedError"
		) {
			setStatus(
				"Paste was cancelled or blocked by Safari.",
				"error",
			);
			return;
		}

		setStatus(
			error instanceof Error
				? error.message
				: "The pasted image could not be read.",
			"error",
		);
	}
}

function handlePastedData(event) {
	const clipboardData = event.clipboardData;

	if (!clipboardData) {
		return;
	}

	const files = [...clipboardData.files];
	const imageFile = files.find(
		(file) => file.type.startsWith("image/"),
	);

	if (imageFile) {
		event.preventDefault();
		void loadLocalImage(imageFile);
		return;
	}

	const clipboardItems =
		[...clipboardData.items];

	const imageItem = clipboardItems.find(
		(item) => item.type.startsWith("image/"),
	);

	if (imageItem) {
		const file = imageItem.getAsFile();

		if (file) {
			event.preventDefault();
			void loadLocalImage(file);
			return;
		}
	}

	const shouldHandleText =
		state.pasteFallbackOpen ||
		event.target === state.pasteTarget;

	if (!shouldHandleText) {
		return;
	}

	const html = clipboardData.getData("text/html");

	if (html) {
		const documentFragment =
			new DOMParser().parseFromString(
				html,
				"text/html",
			);

		const imageSource =
			documentFragment.querySelector("img")
				?.getAttribute("src");

		if (imageSource?.startsWith("data:image/")) {
			event.preventDefault();

			void dataUrlToFile(imageSource)
				.then((file) => {
					return loadLocalImage(file);
				})
				.catch(() => {
					setStatus(
						"The pasted image could not be read.",
						"error",
					);
				});

			return;
		}

		if (imageSource) {
			event.preventDefault();
			void loadClipboardTextUrl(imageSource);
			return;
		}
	}

	const plainText =
		clipboardData.getData("text/uri-list") ||
		clipboardData.getData("text/plain");

	if (plainText) {
		event.preventDefault();

		void loadClipboardTextUrl(plainText)
			.then((loaded) => {
				if (!loaded) {
					setStatus(
						"The pasted content was not an image or image URL.",
						"error",
					);
				}
			});

		return;
	}

	event.preventDefault();
	setStatus(
		"The clipboard did not contain an image.",
		"error",
	);
}


elements.themeToggle.addEventListener("click", () => {
	const nextTheme =
		elements.root.dataset.theme === "dark"
			? "light"
			: "dark";

	applyTheme(nextTheme);
});

elements.uploadButton.addEventListener("click", (event) => {
	event.stopPropagation();
	elements.fileInput.click();
});

elements.dropZone.addEventListener("click", (event) => {
	if (
		event.target.closest("button") ||
		event.target.closest("input")
	) {
		return;
	}

	elements.fileInput.click();
});

elements.dropZone.addEventListener("keydown", (event) => {
	if (
		event.key !== "Enter" &&
		event.key !== " "
	) {
		return;
	}

	event.preventDefault();
	elements.fileInput.click();
});

elements.fileInput.addEventListener("change", () => {
	const [file] = elements.fileInput.files || [];

	if (file) {
		void loadLocalImage(file);
	}
});

for (const eventName of [
	"dragenter",
	"dragover",
]) {
	elements.dropZone.addEventListener(
		eventName,
		(event) => {
			event.preventDefault();
			elements.dropZone.classList.add(
				"is-dragging",
			);
		},
	);
}

for (const eventName of [
	"dragleave",
	"drop",
]) {
	elements.dropZone.addEventListener(
		eventName,
		(event) => {
			event.preventDefault();
			elements.dropZone.classList.remove(
				"is-dragging",
			);
		},
	);
}

elements.dropZone.addEventListener("drop", (event) => {
	const [file] =
		event.dataTransfer?.files || [];

	if (file) {
		void loadLocalImage(file);
	}
});

elements.pasteImageButton.addEventListener(
	"click",
	() => {
		void pasteImageFromClipboard();
	},
);

document.addEventListener(
	"paste",
	handlePastedData,
);

elements.urlForm.addEventListener(
	"submit",
	(event) => {
		event.preventDefault();

		loadImageUrl(
			elements.imageUrlInput.value,
		);
	},
);

elements.imagePreview.addEventListener(
	"error",
	() => {
		if (state.sourceUrl) {
			setStatus(
				"The website blocked the preview, but RISE can still try searching the URL.",
				"error",
			);
		}
	},
);

elements.engineSelect.addEventListener(
	"change",
	() => {
		safeStorageSet(
			localStorage,
			STORAGE_KEYS.engine,
			elements.engineSelect.value,
		);
	},
);

elements.showResultsButton.addEventListener(
	"click",
	() => {
		openEngine(elements.engineSelect.value);
	},
);

for (const chip of elements.engineChips) {
	chip.addEventListener("click", () => {
		openEngine(chip.dataset.engine);
	});
}

elements.resetButton.addEventListener(
	"click",
	() => {
		if (!state.resetArmed) {
			state.resetArmed = true;

			elements.resetButton.classList.add(
				"is-armed",
			);

			elements.resetButton.textContent =
				"Tap Again to Reset";

			state.resetTimer = setTimeout(
				resetResetButton,
				2200,
			);

			return;
		}

		clearCurrentImage();
	},
);

window.addEventListener("beforeunload", () => {
	revokePreviewUrl();
});

initializeToken();
initializeTheme();
initializeEngine();

setActionsEnabled(false);
