/** True when this browsing context exposes WebGPU. No software fallback. */
export function hasWebGpu(): boolean {
	return typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu != null;
}
