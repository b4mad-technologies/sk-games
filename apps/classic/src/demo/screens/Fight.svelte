<script lang="ts">
	// A fight on the tactical grid: click a cell to walk, click a foe to act.
	//
	// Uses the shipped BattleMap, Combat and Economy widgets. BattleMap runs in
	// its selection mode and this screen decides what a click means. That is
	// the opposite of Play's axiom A1 ("the map only selects"), so this app
	// needs its own interaction rules.
	import { Button } from "@spellkave/ui";
	import { BattleMap, type BattleMapExit, type BattleMapToken, Combat, type CombatState, type EconomyChannel } from "@spellkave/ui-widgets";
	import ClickMenu, { type MenuEntry } from "../../lib/ClickMenu.svelte";
	import EventLog from "../EventLog.svelte";
	import { art, type MockAction } from "../fixtures";
	import Gap from "../Gap.svelte";
	import { abilityRows, app, d, say, signed } from "../state.svelte";

	const COLS = 9;
	const ROWS = 6;
	const CELL = 40;
	const SPEED = 6; // 30 ft
	const blocked = new Set(["3,1", "3,2", "6,4", "0,5"]);

	type Unit = { id: string; name: string; x: number; y: number; hp: number; ac: number; art?: string; me?: boolean };

	let units = $state<Unit[]>([
		{ id: "hero", name: app.hero.name, x: 1, y: 3, hp: app.hero.hp, ac: app.hero.ac, me: true },
		{ id: "rat-1", name: "Giant Rat 1", x: 5, y: 1, hp: 7, ac: 13, art: art("creature", "giant-rat") },
		{ id: "rat-2", name: "Giant Rat 2", x: 6, y: 3, hp: 7, ac: 13, art: art("creature", "giant-rat") },
		{ id: "goblin", name: "Goblin Warrior", x: 7, y: 5, hp: 10, ac: 15, art: art("creature", "goblin-warrior") },
	]);
	let myTurn = $state(true);
	let movement = $state(SPEED);
	let actionSpent = $state(false);
	let selected = $state<string | null>(null);
	let menu = $state<{ unit: Unit; x: number; y: number } | null>(null);
	let refusals = $state<Record<string, string>>({});
	let lastRoll = $state<{ die: number; total: number; label: string; hit: boolean } | null>(null);
	let pointer = { x: 200, y: 200 };

	const nodeId = (x: number, y: number) => `cellar/c_${x}_${y}`;
	function cellOf(id: string): { x: number; y: number } | null {
		const match = /c_(\d+)_(\d+)$/.exec(id);
		return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
	}

	const hero = $derived(units.find((unit) => unit.me)!);
	const foes = $derived(units.filter((unit) => !unit.me && unit.hp > 0));
	const over = $derived(foes.length === 0 ? "won" : hero.hp <= 0 ? "lost" : null);
	const occupied = (x: number, y: number) => units.some((unit) => unit.hp > 0 && unit.x === x && unit.y === y);
	const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS && !blocked.has(`${x},${y}`) && !occupied(x, y);
	const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

	const plate = $derived.by(() => {
		let cells = "";
		for (let y = 0; y < ROWS; y += 1) {
			for (let x = 0; x < COLS; x += 1) {
				const at = `x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}"`;
				cells += blocked.has(`${x},${y}`)
					? `<rect ${at} fill="currentColor" fill-opacity="0.35" /><circle cx="${x * CELL + 20}" cy="${y * CELL + 20}" r="13" fill="none" stroke="currentColor" stroke-opacity="0.6" />`
					: `<g data-node-id="${nodeId(x, y)}"><rect class="grid-cell" ${at} fill="currentColor" fill-opacity="0.04" stroke="currentColor" stroke-opacity="0.3" /></g>`;
			}
		}
		return `<svg viewBox="0 0 ${COLS * CELL} ${ROWS * CELL}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
	});

	// One hop only: this is what the world offers today (`spellkave_scene.exits`).
	const exits = $derived.by<BattleMapExit[]>(() => {
		if (!myTurn || movement <= 0 || over) return [];
		const list: BattleMapExit[] = [];
		for (let dy = -1; dy <= 1; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				if (dx === 0 && dy === 0) continue;
				const x = hero.x + dx;
				const y = hero.y + dy;
				if (walkable(x, y)) list.push({ handle: `s:exit:${x}_${y}`, toNodeId: nodeId(x, y), label: `cell ${x},${y}` });
			}
		}
		return list;
	});

	const tokens = $derived<BattleMapToken[]>(
		units
			.filter((unit) => unit.hp > 0)
			.map((unit) => ({ nodeId: nodeId(unit.x, unit.y), actorId: unit.id, name: unit.me ? "You" : unit.name, isMe: unit.me, tone: unit.me ? undefined : "foe" })),
	);

	const combat = $derived<CombatState>({
		mode: myTurn ? "your-turn" : "waiting",
		enemy: foes[0]?.name ?? "",
		status: over === "won" ? "The cellar is quiet." : over === "lost" ? "You are down." : myTurn ? "Your turn. Walk, act, then end the turn." : "Not your turn.",
		roster: units.map((unit, index) => ({
			ordinal: index,
			name: unit.me ? app.hero.name : unit.name,
			isMe: Boolean(unit.me),
			isCurrent: unit.me ? myTurn : false,
			targetRef: unit.me ? undefined : unit.id,
			dead: unit.hp <= 0,
		})),
	});

	const economy = $derived<EconomyChannel[]>([
		{ channelId: "srd/economy_channel/primary", spentMs: actionSpent ? 1 : 0, windowStartMs: 100 },
		{ channelId: "srd/economy_channel/bonus", spentMs: 0, windowStartMs: 100 },
		{ channelId: "srd/economy_channel/reaction", spentMs: 0, windowStartMs: 100 },
	]);

	// "My actions" in a fight, built from the hero's kit and spells.
	const fightActions = $derived.by<MockAction[]>(() => {
		const list: MockAction[] = [];
		const melee = ["Longsword", "Shortsword", "Quarterstaff", "Dagger"].find((item) => app.hero.items.includes(item));
		list.push({ id: "melee", label: `Attack: ${melee ?? "Unarmed"}`, niche: "creature", channel: "action", range: 1 });
		if (app.hero.items.includes("Shortbow")) list.push({ id: "bow", label: "Attack: Shortbow", niche: "creature", channel: "action", range: 16 });
		for (const id of ["fire-bolt", "ray-of-frost", "sacred-flame"]) {
			if (app.hero.cantrips.includes(id)) {
				list.push({ id, label: id.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "), niche: "creature", channel: "action", range: 12, artKind: "spell", artSlug: id });
			}
		}
		if (app.hero.spells.includes("magic-missile")) {
			list.push({ id: "magic-missile", label: "Magic Missile (slot)", niche: "creature", channel: "action", range: 24, artKind: "spell", artSlug: "magic-missile" });
		}
		list.push({ id: "shove", label: "Shove", niche: "creature", channel: "action", range: 1 });
		return list;
	});

	function entriesFor(unit: Unit): MenuEntry[] {
		return fightActions.map((action) => {
			const refusal = refusals[`${action.id}:${unit.id}`];
			return {
				id: action.id,
				label: action.label,
				hint: refusal ? "refused" : `Action · ${action.range === 1 ? "reach" : `${(action.range ?? 1) * 5} ft`}`,
				refused: refusal !== undefined,
				art: action.artKind && action.artSlug ? art(action.artKind, action.artSlug) : undefined,
			};
		});
	}

	function refuse(key: string, reason: string) {
		refusals[key] = reason;
		say("refusal", `The world refuses: ${reason}`);
	}

	/** Shortest walk over free cells; returns the cells after the start. */
	function pathTo(goal: { x: number; y: number }): { x: number; y: number }[] {
		const start = `${hero.x},${hero.y}`;
		const from = new Map<string, string | null>([[start, null]]);
		const queue = [{ x: hero.x, y: hero.y }];
		while (queue.length) {
			const at = queue.shift()!;
			if (at.x === goal.x && at.y === goal.y) break;
			for (let dy = -1; dy <= 1; dy += 1) {
				for (let dx = -1; dx <= 1; dx += 1) {
					const next = { x: at.x + dx, y: at.y + dy };
					const key = `${next.x},${next.y}`;
					if (from.has(key) || !walkable(next.x, next.y)) continue;
					from.set(key, `${at.x},${at.y}`);
					queue.push(next);
				}
			}
		}
		const path: { x: number; y: number }[] = [];
		let key: string | null | undefined = `${goal.x},${goal.y}`;
		if (!from.has(key)) return [];
		while (key && key !== start) {
			const [x, y] = key.split(",").map(Number);
			path.unshift({ x: x!, y: y! });
			key = from.get(key);
		}
		return path;
	}

	function onCell(id: string) {
		if (over) return;
		selected = id;
		const cell = cellOf(id);
		if (!cell) return;
		if (!myTurn) {
			say("refusal", "The world refuses: it is not your turn.");
			return;
		}
		const unit = units.find((entry) => entry.hp > 0 && entry.x === cell.x && entry.y === cell.y);
		if (unit?.me) return;
		if (unit) {
			menu = { unit, x: pointer.x, y: pointer.y };
			return;
		}
		// A free cell: walk there one step at a time, as far as movement lasts.
		const path = pathTo(cell);
		if (path.length === 0) {
			say("refusal", "The world refuses: there is no way to that cell.");
			return;
		}
		if (movement <= 0) {
			say("refusal", "The world refuses: you have no movement left this turn.");
			return;
		}
		const steps = path.slice(0, movement);
		const last = steps[steps.length - 1]!;
		hero.x = last.x;
		hero.y = last.y;
		movement -= steps.length;
		refusals = {};
		say("story", steps.length < path.length ? `You walk ${steps.length * 5} ft and run out of movement.` : `You walk ${steps.length * 5} ft.`);
	}

	function attempt(actionId: string) {
		const unit = menu?.unit;
		menu = null;
		const action = fightActions.find((entry) => entry.id === actionId);
		if (!unit || !action) return;
		const key = `${actionId}:${unit.id}`;
		if (actionSpent) return refuse(key, "you have no action left this turn.");
		if (distance(hero, unit) > (action.range ?? 1)) return refuse(key, `${unit.name} is out of reach.`);
		if (actionId === "magic-missile" && app.hero.slotsUsed >= 2) return refuse(key, "you have no spell slot left.");

		actionSpent = true;
		refusals = {};
		const rows = abilityRows();
		const mod = Math.max(...rows.map((row) => row.modifier)) + 2;
		if (actionId === "magic-missile") {
			app.hero.slotsUsed += 1;
			const damage = d(4) + d(4) + d(4) + 3;
			lastRoll = { die: damage, total: damage, label: "3d4+3 force", hit: true };
			hurt(unit, damage, "Three darts strike");
			return;
		}
		const die = d(20);
		const total = die + mod;
		const hit = die === 20 || (die !== 1 && total >= unit.ac);
		lastRoll = { die, total, label: `d20 ${signed(mod)} vs AC ${unit.ac}`, hit };
		say("roll", `${action.label}: d20 (${die}) ${signed(mod)} = ${total} vs AC ${unit.ac} → ${hit ? "hit" : "miss"}`);
		if (!hit) return;
		if (actionId === "shove") {
			const dx = Math.sign(unit.x - hero.x);
			const dy = Math.sign(unit.y - hero.y);
			if (walkable(unit.x + dx, unit.y + dy)) {
				unit.x += dx;
				unit.y += dy;
			}
			say("story", `You shove ${unit.name} back.`);
			return;
		}
		hurt(unit, d(actionId === "melee" ? 6 : 10) + (actionId === "melee" ? mod - 2 : 0), "You hit");
	}

	function hurt(unit: Unit, amount: number, lead: string) {
		unit.hp = Math.max(0, unit.hp - amount);
		say("story", `${lead} ${unit.name} for ${amount}.${unit.hp === 0 ? ` ${unit.name} drops.` : ""}`);
		if (foes.length === 0) {
			app.hero.xp += 75;
			say("system", "The fight is over. You gain 75 XP.");
		}
	}

	function endTurn() {
		if (over) return;
		myTurn = false;
		menu = null;
		for (const foe of foes) {
			for (let step = 0; step < 4 && distance(foe, hero) > 1; step += 1) {
				const dx = Math.sign(hero.x - foe.x);
				const dy = Math.sign(hero.y - foe.y);
				const options = [
					{ x: foe.x + dx, y: foe.y + dy },
					{ x: foe.x + dx, y: foe.y },
					{ x: foe.x, y: foe.y + dy },
				];
				const next = options.find((cell) => walkable(cell.x, cell.y));
				if (!next) break;
				foe.x = next.x;
				foe.y = next.y;
			}
			if (distance(foe, hero) > 1) {
				say("story", `${foe.name} closes in.`);
				continue;
			}
			const die = d(20);
			const hit = die + 4 >= app.hero.ac;
			say("roll", `${foe.name} bites: d20 (${die}) +4 = ${die + 4} vs AC ${app.hero.ac} → ${hit ? "hit" : "miss"}`);
			if (hit) {
				const damage = d(4) + 1;
				hero.hp = Math.max(0, hero.hp - damage);
				app.hero.hp = hero.hp;
				say("story", `${foe.name} hits you for ${damage}.`);
				if (hero.hp === 0) {
					say("system", "You fall. (Mock-up: start the fight again.)");
					return;
				}
			}
		}
		myTurn = true;
		movement = SPEED;
		actionSpent = false;
		refusals = {};
		say("system", "Your turn.");
	}

	function leave() {
		if (over === "lost") app.hero.hp = app.hero.hpMax;
		app.screen = "world";
	}
</script>

<div class="fight">
	<section class="turn">
		<Combat
			{combat}
			{economy}
			selectionMode
			selectedTargetRef={null}
			onSelectTarget={(ref) => {
				const unit = units.find((entry) => entry.id === ref);
				if (unit) selected = nodeId(unit.x, unit.y);
			}}
			onEndTurn={endTurn}
			busy={!myTurn || over !== null}
			density="stage"
		/>
	</section>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section
		class="map cm-panel"
		onpointerdowncapture={(event) => {
			pointer = { x: event.clientX, y: event.clientY };
		}}
	>
		<BattleMap {plate} ownNodeId={nodeId(hero.x, hero.y)} {exits} onStep={() => {}} refusal={null} selectedNodeId={selected} onSelectCell={onCell} {tokens} viewKey="mock-fight" />
	</section>

	<aside class="side">
		<div class="cm-panel stats">
			<p class="sk-label cm-muted">This turn</p>
			<p><span class="sk-num big">{movement * 5}</span> ft of movement left</p>
			<p>HP <span class="sk-num">{hero.hp}</span> · AC <span class="sk-num">{app.hero.ac}</span> · Slots <span class="sk-num">{2 - app.hero.slotsUsed}</span>/2</p>
			{#if lastRoll}
				<div class="die" class:hit={lastRoll.hit}>
					<span class="sk-num">{lastRoll.die}</span>
					<small>{lastRoll.label} = {lastRoll.total} · {lastRoll.hit ? "hit" : "miss"}</small>
				</div>
			{/if}
			{#if over}
				<Button onclick={leave}>{over === "won" ? "Back to the common room" : "Get carried upstairs"}</Button>
			{/if}
		</div>
		<div class="cm-panel foes">
			<p class="sk-label cm-muted">Foes</p>
			{#each units.filter((unit) => !unit.me) as unit (unit.id)}
				<div class="foe" class:dead={unit.hp <= 0}>
					{#if unit.art}<img class="cm-pixel" src={unit.art} alt="" />{/if}
					<span>{unit.name}</span>
					<small class="cm-muted">{unit.hp <= 0 ? "dead" : unit.hp <= 3 ? "bloodied" : "unhurt"}</small>
				</div>
			{/each}
		</div>
		<Gap title="Tokens on the plate are discs with names; creature art exists but the widget does not draw it." where="packages/spellkave-ui-widgets/src/BattleMap.svelte" />
		<Gap title="Click-to-walk is a client loop of single steps. No reachable-cells read, so no range shading and no path cost." where="packages/spellkave-sdk/src/core/movement.ts:98" />
		<Gap title="Cost and range per action sit in public tables but no reader projects them; the hints in the menu are faked." where="server/src/world_interaction/layer3/affordance_template.rs:69,82" />
		<Gap title="No dice or roll widget, and no round counter (sk-jay0.2.13)." />
	</aside>

	<section class="log cm-panel"><EventLog /></section>
</div>

{#if menu}
	<ClickMenu title={menu.unit.name} subtitle="Pick what to do" entries={entriesFor(menu.unit)} x={menu.x} y={menu.y} onPick={attempt} onClose={() => (menu = null)} />
{/if}

<style>
	.fight {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 19rem;
		grid-template-rows: auto minmax(20rem, 1fr) 11rem;
		gap: 0.75rem;
		padding: 0.75rem;
		height: 100%;
		min-height: 44rem;
	}
	.turn {
		grid-column: 1 / -1;
	}
	.map {
		min-height: 0;
		padding: 0.5rem;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
		overflow-y: auto;
	}
	.stats,
	.foes {
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.stats p,
	.foes p {
		margin: 0;
	}
	.big {
		font-size: 1.5rem;
	}
	.die {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.6rem;
	}
	.die .sk-num {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		font-size: 1.4rem;
		border: 2px solid var(--muted-foreground);
		border-radius: var(--radius-sm);
	}
	.die.hit .sk-num {
		border-color: var(--primary);
		color: var(--primary);
	}
	.foe {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.foe span {
		flex: 1;
	}
	.foe img {
		width: 2.5rem;
		height: 2.5rem;
	}
	.foe.dead span {
		text-decoration: line-through;
		color: var(--muted-foreground);
	}
	.log {
		grid-column: 1 / -1;
		min-height: 0;
	}
	@media (max-width: 60rem) {
		.fight {
			grid-template-columns: 1fr;
			grid-template-rows: auto;
			height: auto;
		}
		.map {
			height: 22rem;
		}
		.log {
			height: 11rem;
		}
	}
</style>
