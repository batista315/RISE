"use strict";

(() => {
	const isTouchDevice =
		navigator.maxTouchPoints > 0 ||
		window.matchMedia?.("(pointer: coarse)").matches;

	/*
	 * Leave the private #token behavior entirely to app.js.
	 * This file does not read, restore, or modify the URL hash.
	 */

	/*
	 * Direct result URLs open more reliably in iOS Safari through a real
	 * target=_blank link. Blank/named windows used by worker searches and
	 * file POST engines still use the browser's original window.open().
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

	function installMobileFixes() {
		const style = document.createElement("style");

		style.textContent = `
			button,
			[role="button"],
			.engine-chip {
				touch-action: manipulation;
			}

			.engine-chip {
				-webkit-user-select: none;
				user-select: none;
			}
		`;

		document.head.append(style);

		const resetButton =
			document.querySelector("#reset-button");

		resetButton?.addEventListener(
			"dblclick",
			(event) => {
				event.preventDefault();
			},
		);

		if (!isTouchDevice) {
			return;
		}

		const pasteButton =
			document.querySelector("#paste-image-button");
		const fileInput =
			document.querySelector("#file-input");
		const imageUrlInput =
			document.querySelector("#image-url");
		const urlForm =
			document.querySelector("#url-form");
		const statusMessage =
			document.querySelector("#status-message");

		if (
			!pasteButton ||
			!fileInput ||
			!imageUrlInput ||
			!urlForm
		) {
			return;
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

			if (type === "success") {
				statusMessage.classList.add("is-success");
			}
		}

		function extensionForType(type) {
			const normalized =
				type?.split(";")[0].trim().toLowerCase();

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

		function sendFileToRise(file) {
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

		function sendUrlToRise(url) {
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

		async function handleNativePaste(event) {
			event.preventDefault();
			event.stopImmediatePropagation();

			if (
				!navigator.clipboard ||
				typeof navigator.clipboard.read !==
					"function"
			) {
				setLocalStatus(
					"This browser does not support direct image paste. Use Upload Image instead.",
					"error",
				);
				return;
			}

			try {
				/*
				 * On iOS Safari, this direct user-initiated read displays
				 * the small native â€œPasteâ€ permission bubble above the
				 * button. The image is returned only after the user taps it.
				 */
				const clipboardItems =
					await navigator.clipboard.read();

				for (
					const clipboardItem of clipboardItems
				) {
					const imageType =
						clipboardItem.types.find(
							(type) =>
								type.startsWith(
									"image/",
								),
						);

					if (imageType) {
						const blob =
							await clipboardItem.getType(
								imageType,
							);

						const pastedFile = new File(
							[blob],
							`pasted-image.${extensionForType(
								imageType,
							)}`,
							{
								type: imageType,
								lastModified:
									Date.now(),
							},
						);

						if (
							!sendFileToRise(
								pastedFile,
							)
						) {
							throw new Error(
								"Safari returned the image, but RISE could not attach it.",
							);
						}

						return;
					}

					const textType =
						clipboardItem.types.find(
							(type) =>
								type ===
									"text/uri-list" ||
								type ===
									"text/plain",
						);

					if (textType) {
						const blob =
							await clipboardItem.getType(
								textType,
							);

						const text =
							(await blob.text()).trim();

						if (
							/^https?:\/\//i.test(
								text,
							)
						) {
							sendUrlToRise(text);
							return;
						}
					}
				}

				setLocalStatus(
					"The clipboard did not contain an image or image URL.",
					"error",
				);
			} catch (error) {
				if (
					error instanceof DOMException &&
					error.name === "NotAllowedError"
				) {
					setLocalStatus(
						"Paste was cancelled or blocked by Safari.",
						"error",
					);
					return;
				}

				setLocalStatus(
					error instanceof Error
						? error.message
						: "The pasted image could not be read.",
					"error",
				);
			}
		}

		/*
		 * Capture phase prevents app.js from opening its old editable
		 * fallback after this native clipboard request.
		 */
		pasteButton.addEventListener(
			"click",
			(event) => {
				void handleNativePaste(event);
			},
			true,
		);
	}

	if (document.readyState === "loading") {
		document.addEventListener(
			"DOMContentLoaded",
			installMobileFixes,
			{ once: true },
		);
	} else {
		installMobileFixes();
	}
})();
