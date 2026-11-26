import "./styles.css";

import { SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { mount } from "svelte";
import App from "./App.svelte";
import type { OpenPlaySessionArgs } from "./lib/play-session";
import { HERO_DRAFTING_CONDITION_ID, hideDraftVitals, type PlayView } from "./lib/play-view";
import {
	brawlView,
	configuredSheetView,
	fakeHandle,
	fightCrowdView,
	fightView,
	fightWithConditionsView,
	placeDetailView,
	reactionView,
	sampleView,
	streamDetailView,
	talkBurstView,
	talkGroupView,
	talkView,
} from "./test/sample-view";

// `demo.html?beat=explore|talk|talk-burst|talk-group|fight|reaction|brawl`
// (plus the layout-stress beats below: pack-long, field-detail-long,
// place-long, hero-drafting, place-detail, stream-detail, configured-sheet)
// selects one recorded fixture; an unknown or missing beat falls back to
// explore (the common room). `talk-burst` and `talk-group` are the thread's
// own beats (sk-jay0.1.8.12): a four-line burst with a line-bound offered
// action and a numbered prompt, and a group exchange between three
// speakers. `brawl` is sessionless combat-group offers in Explore, not a
// fight frame.
// `configured-sheet` is a synthetic non-SRD value set for opening You.
const sampleTorch = sampleView.pack[2];
const sampleSword = sampleView.pack[0];
const sampleSwordDetail = sampleView.itemDetail;
const samplePlace = placeDetailView.place;
if (!sampleTorch || !sampleSword || !sampleSwordDetail || !samplePlace)
	throw new Error("Demo fixtures missing");
const BEATS: Record<string, PlayView> = {
	explore: sampleView,
	"place-detail": placeDetailView,
	"stream-detail": streamDetailView,
	// Layout stress fixture, not adventure content or a claim about world inventory.
	"pack-long": {
		...sampleView,
		pack: [
			...Array.from({ length: 40 }, (_, i) => ({
				...sampleTorch,
				id: `fixture-${i}`,
				name: `Torch ${i + 1}`,
			})),
			sampleSword,
		],
	},
	"configured-sheet": configuredSheetView,
	// Layout stress fixtures for `check:tile-clip`'s layout probes (batch 7,
	// G6), not adventure content: a Place card with a long description, three
	// occupants and five way-out rows (all five fit the card's row budget, no
	// "+N more"), and a hero still being drafted (no HP/AC/XP figures). The
	// drafting hero goes through `hideDraftVitals`, the same step the live
	// session applies, so the demo shows what a live drafting hero shows.
	"place-long": {
		...placeDetailView,
		place: {
			...samplePlace,
			description: Array.from(
				{ length: 14 },
				(_, i) =>
					`Sentence ${i + 1} of a long synthetic place description that must scroll inside the Place card while the rows below it keep their size.`,
			).join(" "),
			exits: [
				["north", "inn/bar", "Bar"],
				["southeast", "inn/stairs", "Stairs"],
				["west", "inn/foyer", "Foyer"],
				["east", "inn/kitchen", "Kitchen"],
				["down", "inn/cellar", "Cellar"],
			].map(([label, to, toName], i) => ({
				handle: `s:exit:${i + 1}`,
				rev: `r${i + 1}`,
				label: label ?? "",
				to: to ?? null,
				toName: toName ?? "",
				gates: [],
			})),
		},
	},
	"hero-drafting": {
		...sampleView,
		hero: hideDraftVitals({
			...sampleView.hero,
			drafting: true,
			conditions: [HERO_DRAFTING_CONDITION_ID],
			conditionDetails: [{ id: HERO_DRAFTING_CONDITION_ID, label: "Drafting" }],
		}),
	},
	"field-detail-long": {
		...sampleView,
		hero: {
			...sampleView.hero,
			vitals: [
				{
					id: "example/field",
					label: "Field detail example",
					value: "0",
					description: Array.from(
						{ length: 24 },
						(_, i) =>
							`Paragraph ${i + 1}. This synthetic field description exercises reading a long explanation in a narrow dialog. Its value and complete text must remain available without expanding the page beyond the viewport.`,
					).join("\n\n"),
				},
			],
		},
	},
	talk: talkView,
	"talk-burst": talkBurstView,
	"talk-group": talkGroupView,
	fight: fightView,
	// The tracker's dead-struck chip and condition-token row (S5,
	// sk-jay0.1.8.41): a separate beat rather than `fight` itself — the
	// plain fight beat's own card-density budget at 390×844 is already the
	// tightest S1/S3 tuned it to (`check:tile-clip`), and this beat's own
	// extra roster chip is not covered by that check's fixed beat list
	// (`scripts/no-scroll.sh`/`scripts/tile-clip.sh`, same pattern as the
	// existing `fight-talk` beat below).
	"fight-conditions": fightWithConditionsView,
	// Same rationale as `fight-conditions` above, a roster-size stress
	// instead of a conditions stress (sk-jay0.1.8.37 follow-up, phone-width
	// budget): six tracker chips, the card-density strip's own scroll fix.
	"fight-crowd": fightCrowdView,
	reaction: reactionView,
	brawl: brawlView,
	"fight-talk": {
		...fightView,
		speech: talkView.speech,
		actions: [...fightView.actions, ...talkView.actions],
	},
};
const beat = new URLSearchParams(window.location.search).get("beat") ?? "explore";
const view = BEATS[beat] ?? sampleView;

window.sessionStorage.setItem(
	SESSION_STORAGE_KEY,
	JSON.stringify({
		access_token: "local-demo-token",
		id_token: "",
		expires_at: Date.now() + 3_600_000,
		display_name: "Marcel",
	}),
);
window.history.replaceState({}, "", `/demo.html?world=demo1&beat=${beat}`);

const target = document.getElementById("app");
if (target === null) throw new Error("play demo mount target #app is missing");

mount(App, {
	target,
	props: {
		accountLoader: async () => ({
			sub: "local-demo",
			capabilities: [],
			worlds: [
				{
					slug: "demo1",
					display_name: "Elven Mini",
					role: "member" as const,
					capabilities: ["world.observe", "world.play"],
				},
			],
			seat: { slug: "demo1", actor_id: "7", role: "primary" },
		}),
		catalogLoader: async () => [{ slug: "demo1", name: "Elven Mini", db: "spellkave-demo1" }],
		worldOpener: async (args: OpenPlaySessionArgs) => {
			args.onView(view);
			return fakeHandle(
				beat === "pack-long"
					? {
							selectItem: async (item) =>
								args.onView({
									...view,
									itemDetail:
										item === null
											? null
											: item.id === "12"
												? {
														...sampleSwordDetail,
														description: "A plain, well-oiled blade.",
													}
												: {
														id: item.id,
														kind: "Light",
														slot: null,
														facts: [],
														verbs: [],
														description: "A pitch-wrapped brand.\n\n".repeat(60),
													},
								}),
						}
					: {},
			);
		},
	},
});
