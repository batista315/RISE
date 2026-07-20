"use strict";

(() => {
	const isTouchDevice =
		navigator.maxTouchPoints > 0 ||
		window.matchMedia?.("(pointer: coarse)").matches;

	/*
	 * Leave the private #token behavior entirely to app.js.
	 * This file does not implement paste behavior.
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

	function installTouchFixes() {
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

		document
			.querySelector("#reset-button")
			?.addEventListener("dblclick", (event) => {
				event.preventDefault();
			});
	}

	if (document.readyState === "loading") {
		document.addEventListener(
			"DOMContentLoaded",
			installTouchFixes,
			{ once: true },
		);
	} else {
		installTouchFixes();
	}
})();