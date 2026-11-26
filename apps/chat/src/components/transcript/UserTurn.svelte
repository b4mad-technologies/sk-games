<script lang="ts">
	let { text }: { text: string } = $props();
</script>

<li data-testid="chat-user" class="text-foreground">You: {text}</li>
