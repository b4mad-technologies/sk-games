<script lang="ts">
	import {
		type AuthConfig,
		type AuthSession,
		completeLogin,
		decodeJwtPayload,
		endAuthSession,
		readAuthConfig,
		readSession,
		type SessionRenewalState,
		startLogin,
		startSessionRenewal,
	} from "@spellkave/authkit";
	import { Button, ProductMasthead, productNavigation } from "@spellkave/ui";
	import { initTheme } from "@spellkave/ui/theme";
	import { onMount } from "svelte";
	import ChatPane from "./components/ChatPane.svelte";
	import TileColumn from "./components/TileColumn.svelte";
	import { CALLBACK_PATH, CHAT_PATH } from "./lib/auth-routes";
	import { readMcpResource } from "./lib/mcp/url";

	initTheme();

	type Gate = "loading" | "unconfigured" | "signed-out" | "ready";

	let gate = $state<Gate>("loading");
	let session = $state<AuthSession | null>(null);
	let error = $state<string | null>(null);
	let config: AuthConfig | null = null;
	let authRenewal: ReturnType<typeof startSessionRenewal> | null = null;
	let renewalStatus: SessionRenewalState["status"] = "signed-out";

	function sessionSub(active: AuthSession): string {
		const sub = decodeJwtPayload(active.id_token).sub;
		return typeof sub === "string" ? sub : "";
	}

	function signIn(): void {
		if (config === null) return;
		error = null;
		void startLogin(
			config,
			window.location.origin,
			window.sessionStorage,
			(url) => {
				window.location.assign(url);
			},
			CALLBACK_PATH,
		);
	}

	function signOut(): void {
		session = null;
		gate = "signed-out";
		endAuthSession(window.sessionStorage, config ?? {}, `${window.location.origin}/`);
	}

	onMount(() => {
		let disposed = false;
		const auth = readAuthConfig(import.meta.env as Record<string, string | undefined>);
		if (auth !== null) {
			config = { ...auth, resource: readMcpResource(import.meta.env as Record<string, string | undefined>) };
			authRenewal = startSessionRenewal({
				config, storage: window.sessionStorage, fetch, window, document,
				onChange: (next) => {
					session = next.session;
					renewalStatus = next.status;
					gate = next.session !== null ? "ready" : next.status === "signed-out" ? "signed-out" : "loading";
				},
			});
		}
		void (authRenewal?.ready ?? Promise.resolve(null)).then(() => {
			if (!disposed && renewalStatus !== "retrying") initializeAuth();
		});
		return () => { disposed = true; authRenewal?.stop(); };
	});

	function initializeAuth(): void {
		const auth = readAuthConfig(import.meta.env as Record<string, string | undefined>);
		if (auth === null) {
			gate = "unconfigured";
			return;
		}
		config = {
			...auth,
			resource: readMcpResource(import.meta.env as Record<string, string | undefined>),
		};
		if (window.location.pathname === CALLBACK_PATH) {
			void (async () => {
				try {
					const active = await completeLogin(
						config as AuthConfig,
						window.location.href,
						window.sessionStorage,
						fetch.bind(window),
					);
					window.history.replaceState({}, "", CHAT_PATH);
					session = active;
					void authRenewal?.check();
					gate = "ready";
				} catch (cause) {
					window.history.replaceState({}, "", CHAT_PATH);
					gate = "signed-out";
					error = cause instanceof Error ? cause.message : String(cause);
				}
			})();
			return;
		}
		const existing = readSession(window.sessionStorage);
		if (existing === null) {
			gate = "signed-out";
			return;
		}
		session = existing;
		gate = "ready";
	}
</script>

<div class="min-h-screen bg-background text-foreground">
	<ProductMasthead
		brand="Spellkave Chat"
		brandHref={null}
		contextText="chat.spellkave.com"
		navigation={productNavigation("chat")}
		signInHref={null}
		account={session ? { displayName: session.display_name } : null}
		onSignOut={signOut}
	/>

	<main class="mx-auto flex max-w-[96rem] flex-col gap-6 px-4 py-8">
		{#if error !== null}
			<p
				class="rounded-[var(--radius)] border border-destructive bg-destructive/10 px-3 py-2 text-sm text-foreground"
				role="alert"
			>
				{error}
			</p>
		{/if}

		{#if gate === "loading"}
			<p class="text-sm text-muted-foreground">Loading chat…</p>
		{:else if gate === "unconfigured"}
			<div class="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-card p-6">
				<h1
					class="[font-family:var(--font-display)] text-[1.5rem] font-medium leading-[1.25] tracking-[-0.025em]"
				>
					This page is not configured
				</h1>
				<p class="max-w-[65ch] text-sm text-muted-foreground">
					It was built without a WorkOS client ID or issuer, so it cannot sign anyone in. This is a
					deployment problem, not a chat problem.
				</p>
			</div>
		{:else if gate === "signed-out"}
			<div class="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-6">
				<h1
					class="[font-family:var(--font-display)] text-[1.5rem] font-medium leading-[1.25] tracking-[-0.025em]"
				>
					Sign in to chat
				</h1>
				<p class="max-w-[65ch] text-sm text-muted-foreground">
					This page will run a language model in your browser. Sign in with your Spellkave account
					to continue.
				</p>
				<div>
					<Button variant="woven-primary" onclick={signIn}>Sign in with WorkOS</Button>
				</div>
			</div>
		{:else if session !== null}
			<div class="flex min-h-[70vh] flex-col gap-4 lg:flex-row">
				<ChatPane accessToken={session.access_token} userSub={sessionSub(session)} />
				<TileColumn />
			</div>
		{/if}
	</main>
</div>
