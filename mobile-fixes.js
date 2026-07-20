"use strict";

(() => {
	const isTouchDevice =
		navigator.maxTouchPoints > 0 ||
		window.matchMedia?.("(pointer: coarse)").matches;

	/*
	 * Leave the private #token behavior entirely to app.js.
	 * This file deliberately does not read, restore, or modify the URL hash.
	 */

	/*
	 * iOS Safari is substantially more reliable when a direct result URL is
	 * opened through a real target=_blank link instead of window.open(url).
	 * Blank/named windows used by worker searches and file POST engines still
	 * use the original window.open implementation.
	 */
	const nativeWindowOpen = window.open.bind(window);

	window.open = (url, target, features) => {
		if (
			isTouchDevice &&
			target === "_blank" &&
			typeof url === "string" &&
			url.trim()
		) {
			const link = document.createElement("a");
			link.href = url;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.hidden = true;

			document.body.append(link);
			link.click();
			link.remove();

			return {
				opener: null,
				close() {},
			};
		}

		return nativeWindowOpen(url, target, features);
	};

	function installMobileInteractionFixes() {
		const style = document.createElement("style");

		style.textContent = `
			html {
				scrollbar-gutter: stable;
			}

			button,
			[role="button"],
			.engine-chip,
			.rise-native-paste-target {
				touch-action: manipulation;
			}

			.engine-chip {
				-webkit-user-select: none;
				user-select: none;
			}

			.rise-native-paste-overlay {
				position: fixed;
				inset: 0;
				z-index: 2000;
				display: grid;
				place-items: center;
				padding:
					max(18px, env(safe-area-inset-top))
					18px
					max(18px, env(safe-area-inset-bottom));
				background: rgba(0, 0, 0, 0.76);
				backdrop-filter: blur(9px);
				-webkit-backdrop-filter: blur(9px);
			}

			.rise-native-paste-overlay[hidden] {
				display: none !important;
			}

			.rise-native-paste-dialog {
				width: min(100%, 460px);
				padding: 20px;
				border: 1px solid var(--card-border);
				border-radius: 20px;
				background: var(--card-bg);
				box-shadow: var(--shadow-card);
			}

			.rise-native-paste-title {
				margin: 0 0 8px;
				font-size: 1.22rem;
				letter-spacing: -0.02em;
			}

			.rise-native-paste-copy {
				margin: 0 0 14px;
				color: var(--text-muted);
				line-height: 1.45;
			}

			.rise-native-paste-target {
				display: grid;
				min-height: 170px;
				padding: 22px;
				place-items: center;
				border: 1.5px dashed var(--card-border-strong);
				border-radius: 16px;
				outline: none;
				background: var(--field-bg);
				color: var(--text-muted);
				text-align: center;
				-webkit-user-select: text;
				user-select: text;
			}

			.rise-native-paste-target:focus {
				border-color: var(--accent);
				box-shadow: 0 0 0 4px var(--focus-ring);
			}

			.rise-native-paste-target img {
				display: block;
				max-width: 100%;
				max-height: 150px;
				object-fit: contain;
			}

			.rise-native-paste-cancel {
				width: 100%;
				min-height: 48px;
				margin-top: 14px;
				border: 1px solid var(--card-border-strong);
				border-radius: 12px;
				background: transparent;
				color: var(--text-main);
				font: inherit;
				font-weight: 700;
			}
		`;

		document.head.append(style);

		const resetButton = document.querySelector("#reset-button");

		resetButton?.addEventListener("dblclick", (event) => {
			event.preventDefault();
		});

		if (!isTouchDevice) {
			return;
		}

		const pasteButton =
			document.querySelector("#paste-image-button");
		const fileInput =
			document.querySelector("#file-input");
		const urlForm =
			document.querySelector("#url-form");
		const imageUrlInput =
			document.querySelector("#image-url");
		const statusMessage =
			document.querySelector("#status-message");

		if (
			!pasteButton ||
			!fileInput ||
			!urlForm ||
			!imageUrlInput
		) {
			return;
		}

		const overlay = document.createElement("div");
		overlay.className = "rise-native-paste-overlay";
		overlay.hidden = true;

		const dialog = document.createElement("section");
		dialog.className = "rise-native-paste-dialog";
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		dialog.setAttribute(
			"aria-labelledby",
			"rise-native-paste-title",
		);

		const title = document.createElement("h2");
		title.id = "rise-native-paste-title";
		title.className = "rise-native-paste-title";
		title.textContent = "Paste Image";

		const instructions = document.createElement("p");
		instructions.className = "rise-native-paste-copy";
		instructions.textContent =
			"Touch and hold inside the box, then choose Paste.";

		const target = document.createElement("div");
		target.className = "rise-native-paste-target";
		target.contentEditable = "true";
		target.setAttribute("role", "textbox");
		target.setAttribute(
			"aria-label",
			"Paste an image here",
		);
		target.setAttribute("autocapitalize", "off");
		target.setAttribute("autocomplete", "off");
		target.setAttribute("spellcheck", "false");

		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "rise-native-paste-cancel";
		cancel.textContent = "Cancel";

		dialog.append(
			title,
			instructions,
			target,
			cancel,
		);
		overlay.append(dialog);
		document.body.append(overlay);

		let pasteHandling = false;

		function resetTarget() {
			target.replaceChildren(
				document.createTextNode(
					"Touch and hold here, then tap Paste",
				),
			);
		}

		function setLocalStatus(message, type = "") {
			if (!statusMessage) {
				return;
			}

			statusMessage.textContent = message;
			statusMessage.classList.remove(
				"is-error",
				"is-success",
			);

			if (type === "error") {
				statusMessage.classList.add("is-error");
			}
		}

		function closeOverlay() {
			overlay.hidden = true;
			pasteHandling = false;
			resetTarget();
		}

		function openOverlay(event) {
			event.preventDefault();
			event.stopImmediatePropagation();

			resetTarget();
			overlay.hidden = false;

			window.setTimeout(() => {
				target.focus({ preventScroll: true });
			}, 0);
		}

		function sendFileToApp(file) {
			if (
				typeof window.loadLocalImage === "function"
			) {
				void window.loadLocalImage(file);
				return true;
			}

			try {
				const transfer = new DataTransfer();
				transfer.items.add(file);
				fileInput.files = transfer.files;
				fileInput.dispatchEvent(
					new Event("change", {
						bubbles: true,
					}),
				);
				return true;
			} catch {
				return false;
			}
		}

		function sendUrlToApp(url) {
			if (
				typeof window.loadImageUrl === "function"
			) {
				window.loadImageUrl(url);
				return;
			}

			imageUrlInput.value = url;
			urlForm.dispatchEvent(
				new Event("submit", {
					bubbles: true,
					cancelable: true,
				}),
			);
		}

		function extensionForType(type) {
			const normalized =
				type?.split(";")[0].toLowerCase();

			const extensions = {
				"image/jpeg": "jpg",
				"image/png": "png",
				"image/webp": "webp",
				"image/gif": "gif",
				"image/avif": "avif",
				"image/heic": "heic",
				"image/heif": "heif",
				"image/bmp": "bmp",
				"image/tiff": "tiff",
			};

			return extensions[normalized] || "png";
		}

		async function sourceToFile(source) {
			const response = await fetch(source);
			const blob = await response.blob();

			if (!blob.type.startsWith("image/")) {
				throw new Error(
					"The pasted content was not an image.",
				);
			}

			return new File(
				[blob],
				`pasted-image.${extensionForType(blob.type)}`,
				{
					type: blob.type,
					lastModified: Date.now(),
				},
			);
		}

		async function acceptSource(source) {
			if (!source) {
				return false;
			}

			if (
				source.startsWith("data:image/") ||
				source.startsWith("blob:")
			) {
				const file = await sourceToFile(source);

				if (!sendFileToApp(file)) {
					throw new Error(
						"The browser refused the pasted image.",
					);
				}

				closeOverlay();
				return true;
			}

			if (/^https?:\/\//i.test(source)) {
				sendUrlToApp(source);
				closeOverlay();
				return true;
			}

			return false;
		}

		async function inspectInsertedContent() {
			if (pasteHandling) {
				return;
			}

			pasteHandling = true;

			try {
				const imageSource =
					target.querySelector("img")
						?.getAttribute("src");

				if (await acceptSource(imageSource)) {
					return;
				}

				const text =
					target.textContent?.trim() || "";

				if (await acceptSource(text)) {
					return;
				}

				setLocalStatus(
					"The pasted content was not an image or image URL.",
					"error",
				);
				resetTarget();
			} catch (error) {
				setLocalStatus(
					error instanceof Error
						? error.message
						: "The pasted image could not be read.",
					"error",
				);
				resetTarget();
			} finally {
				pasteHandling = false;
			}
		}

		pasteButton.addEventListener(
			"click",
			openOverlay,
			true,
		);

		cancel.addEventListener("click", closeOverlay);

		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				closeOverlay();
			}
		});

		target.addEventListener(
			"touchend",
			() => {
				target.focus({ preventScroll: true });
			},
			{ passive: true },
		);

		target.addEventListener("paste", (event) => {
			event.stopPropagation();

			const clipboardData = event.clipboardData;

			if (!clipboardData) {
				window.setTimeout(
					inspectInsertedContent,
					0,
				);
				return;
			}

			const imageFile =
				[...clipboardData.files].find((file) =>
					file.type.startsWith("image/"),
				);

			if (imageFile && sendFileToApp(imageFile)) {
				event.preventDefault();
				closeOverlay();
				return;
			}

			const imageItem =
				[...clipboardData.items].find((item) =>
					item.type.startsWith("image/"),
				);

			const itemFile = imageItem?.getAsFile();

			if (itemFile && sendFileToApp(itemFile)) {
				event.preventDefault();
				closeOverlay();
				return;
			}

			const html =
				clipboardData.getData("text/html");

			if (html) {
				const parsed =
					new DOMParser().parseFromString(
						html,
						"text/html",
					);

				const imageSource =
					parsed.querySelector("img")
						?.getAttribute("src");

				if (imageSource) {
					event.preventDefault();

					void acceptSource(imageSource)
						.catch((error) => {
							setLocalStatus(
								error.message,
								"error",
							);
						});

					return;
				}
			}

			const text = (
				clipboardData.getData(
					"text/uri-list",
				) ||
				clipboardData.getData("text/plain")
			).trim();

			if (/^https?:\/\//i.test(text)) {
				event.preventDefault();
				sendUrlToApp(text);
				closeOverlay();
				return;
			}

			/*
			 * Safari may insert the copied image into contenteditable
			 * without exposing it through clipboardData. Let insertion
			 * happen, then inspect the resulting <img> or text.
			 */
			window.setTimeout(
				inspectInsertedContent,
				0,
			);
		});

		target.addEventListener("input", () => {
			window.setTimeout(
				inspectInsertedContent,
				0,
			);
		});

		resetTarget();
	}

	if (document.readyState === "loading") {
		document.addEventListener(
			"DOMContentLoaded",
			installMobileInteractionFixes,
			{ once: true },
		);
	} else {
		installMobileInteractionFixes();
	}
})();