import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWebGpu } from "../lib/has-webgpu";
import { catalogEntry } from "../lib/llm/catalog";
import { emptyUsage } from "../lib/llm/events";
import type { BrowserModelProvider } from "../lib/llm/provider";
import { ChatAssistantStream } from "../lib/llm/stream";
import { createWebLlmProvider } from "../lib/llm/webllm";
import { bindWorldToAgent } from "../lib/mcp/world";
import { createMemoryStorage, transcriptKey } from "../lib/transcript-idb";
import ChatPane from "./ChatPane.svelte";

vi.mock("../lib/has-webgpu", () => ({
	hasWebGpu: vi.fn(() => false),
}));

vi.mock("../lib/llm/webllm", () => ({
	createWebLlmProvider: vi.fn(),
}));

vi.mock("../lib/mcp/world", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/mcp/world")>();
	return {
		...actual,
		bindWorldToAgent: vi.fn(actual.bindWorldToAgent),
	};
});

afterEach(() => {
	vi.mocked(hasWebGpu).mockReturnValue(false);
	vi.mocked(createWebLlmProvider).mockReset();
	vi.mocked(bindWorldToAgent).mockReset();
});

function fakeStreamFn(): StreamFn {
	const streamFn: StreamFn = (model) => {
		const stream = new ChatAssistantStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "Hello from the fake model." }],
			api: "openai-completions",
			provider: "webllm",
			model: model.id,
			usage: emptyUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "text_start", contentIndex: 0, partial: message });
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: "Hello from the fake model.",
				partial: message,
			});
			stream.push({
				type: "text_end",
				contentIndex: 0,
				content: "Hello from the fake model.",
				partial: message,
			});
			stream.push({ type: "done", reason: "stop", message });
			stream.end();
		});
		return stream as unknown as ReturnType<StreamFn>;
	};
	return streamFn;
}

function hangingStreamFn(): StreamFn {
	const streamFn: StreamFn = (model, _context, options) => {
		const stream = new ChatAssistantStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "partial" }],
			api: "openai-completions",
			provider: "webllm",
			model: model.id,
			usage: emptyUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "text_start", contentIndex: 0, partial: message });
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: "partial",
				partial: message,
			});
		});
		const abort = (): void => {
			message.stopReason = "aborted";
			message.errorMessage = "Request was aborted";
			stream.push({ type: "error", reason: "aborted", error: message });
			stream.end();
		};
		if (options?.signal?.aborted) abort();
		else options?.signal?.addEventListener("abort", abort, { once: true });
		return stream as unknown as ReturnType<StreamFn>;
	};
	return streamFn;
}

function fakeProvider(streamFn: StreamFn = fakeStreamFn()): BrowserModelProvider {
	const entry = catalogEntry();
	return {
		id: entry.id,
		label: entry.label,
		supportsTools: entry.supportsTools,
		load: async (onProgress) => {
			onProgress({ progress: 1, text: "Ready" });
		},
		createStreamFn: () => streamFn,
		dispose: () => undefined,
	};
}

describe("ChatPane", () => {
	it("explains missing WebGPU instead of crashing", () => {
		render(ChatPane);
		expect(screen.getByTestId("chat-pane")).toBeTruthy();
		expect(screen.getByTestId("webgpu-missing").textContent).toMatch(/no WebGPU/i);
		expect(screen.queryByTestId("model-picker")).toBeNull();
		expect((screen.getByTestId("chat-input") as HTMLTextAreaElement).disabled).toBe(true);
	});

	it("keeps chatting when the world MCP connect fails", async () => {
		vi.mocked(bindWorldToAgent).mockResolvedValue({
			status: { kind: "disconnected", reason: "gateway down" },
			client: null,
		});
		vi.mocked(hasWebGpu).mockReturnValue(true);
		vi.mocked(createWebLlmProvider).mockReturnValue(fakeProvider());
		render(ChatPane, { props: { accessToken: "tok" } });

		await fireEvent.click(screen.getByTestId("model-load"));
		const input = await waitFor(() => {
			const textarea = screen.getByTestId("chat-input") as HTMLTextAreaElement;
			expect(textarea.disabled).toBe(false);
			return textarea;
		});
		await waitFor(() => {
			expect(screen.getByTestId("world-status").textContent).toMatch(
				/not connected \(gateway down\)/,
			);
		});

		await fireEvent.input(input, { target: { value: "Hi" } });
		await fireEvent.click(screen.getByTestId("chat-send"));

		await waitFor(() => {
			expect(screen.getByTestId("chat-assistant").textContent).toMatch(
				/Hello from the fake model/i,
			);
			expect((screen.getByTestId("chat-input") as HTMLTextAreaElement).disabled).toBe(false);
		});
	});

	it("re-enables the textarea after one full assistant turn", async () => {
		vi.mocked(hasWebGpu).mockReturnValue(true);
		vi.mocked(createWebLlmProvider).mockReturnValue(fakeProvider());
		render(ChatPane);

		await fireEvent.click(screen.getByTestId("model-load"));
		const input = await waitFor(() => {
			const textarea = screen.getByTestId("chat-input") as HTMLTextAreaElement;
			expect(textarea.disabled).toBe(false);
			return textarea;
		});

		await fireEvent.input(input, { target: { value: "Hi" } });
		await fireEvent.click(screen.getByTestId("chat-send"));

		await waitFor(() => {
			expect(screen.getByTestId("chat-assistant").textContent).toMatch(
				/Hello from the fake model/i,
			);
			expect((screen.getByTestId("chat-input") as HTMLTextAreaElement).disabled).toBe(false);
		});
	});

	it("stops a running turn and marks it aborted", async () => {
		vi.mocked(hasWebGpu).mockReturnValue(true);
		vi.mocked(createWebLlmProvider).mockReturnValue(fakeProvider(hangingStreamFn()));
		render(ChatPane);

		await fireEvent.click(screen.getByTestId("model-load"));
		const input = await waitFor(() => {
			const textarea = screen.getByTestId("chat-input") as HTMLTextAreaElement;
			expect(textarea.disabled).toBe(false);
			return textarea;
		});
		await fireEvent.input(input, { target: { value: "Hi" } });
		await fireEvent.click(screen.getByTestId("chat-send"));
		const stop = await waitFor(() => screen.getByTestId("chat-stop"));
		await fireEvent.click(stop);
		await waitFor(() => {
			expect(screen.getByTestId("chat-aborted").textContent).toMatch(/aborted/i);
			expect(screen.queryByTestId("chat-stop")).toBeNull();
		});
	});

	it("restores a persisted transcript after reload", async () => {
		vi.mocked(hasWebGpu).mockReturnValue(true);
		vi.mocked(createWebLlmProvider).mockReturnValue(fakeProvider());
		const storage = createMemoryStorage();
		const userSub = "user-sub-1";
		const { unmount } = render(ChatPane, {
			props: { userSub, transcriptStorage: storage },
		});

		await fireEvent.click(screen.getByTestId("model-load"));
		const input = await waitFor(() => {
			const textarea = screen.getByTestId("chat-input") as HTMLTextAreaElement;
			expect(textarea.disabled).toBe(false);
			return textarea;
		});
		const expectedKey = transcriptKey(userSub, catalogEntry().id);
		await fireEvent.input(input, { target: { value: "Hi" } });
		await fireEvent.click(screen.getByTestId("chat-send"));
		await waitFor(() => {
			expect(screen.getByTestId("chat-assistant").textContent).toMatch(
				/Hello from the fake model/i,
			);
			expect((screen.getByTestId("chat-input") as HTMLTextAreaElement).disabled).toBe(false);
		});
		const stored = await storage.load(expectedKey);
		expect(stored?.some((message) => message.role === "user")).toBe(true);
		unmount();

		vi.mocked(createWebLlmProvider).mockReturnValue(fakeProvider());
		render(ChatPane, { props: { userSub, transcriptStorage: storage } });
		await fireEvent.click(screen.getByTestId("model-load"));
		await waitFor(() => {
			expect(screen.getByTestId("chat-user").textContent).toMatch(/Hi/);
			expect(screen.getByTestId("chat-assistant").textContent).toMatch(
				/Hello from the fake model/i,
			);
		});
	});
});
