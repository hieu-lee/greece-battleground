import { buildings, fates, featureTags, holdsTags } from "./rules.ts";
import type { BuildingId, FateId, Holder } from "./rules.ts";
import type { Feature, TileId } from "./map.ts";

export type CharmTarget = BuildingId | Feature;

// Concrete original module interfaces; rechecked by the feature Fate receiver proof.
const receiverCapabilities = {
  "polis-hall": [true, true],
  "altar-of-kings": [false, true],
  forge: [false, false],
  "javelin-camp": [true, false],
  "apollo-fountain": [false, true],
  "iris-bridge": [false, false],
  brewery: [false, true],
  "sacred-fire": [false, false],
  "defense-tower": [true, false],
  "tombs-of-erebus": [true, false],
  farm: [false, true],
  "gate-of-hades": [true, false],
  "gate-of-etna": [true, false],
  "healers-hut": [true, false],
  "tritons-conch": [true, false],
  "altar-of-olympus": [true, true],
  house: [false, true],
  "hunters-lodge": [false, true],
  "gigantes-camp": [true, false],
  "dactyl-camp": [true, false],
  agora: [false, true],
  "menders-hut": [true, false],
  "spring-of-mnemosyne": [false, true],
  "silver-mine": [true, true],
  "thunderbolt-of-zeus": [true, false],
  "pit-of-tartarus": [false, false],
  "offering-well": [false, true],
  "scout-camp": [false, true],
  "sentry-camp": [true, false],
  sheepfold: [false, true],
  "shield-camp": [true, false],
  "skull-of-typhon": [true, false],
  "archer-camp": [true, false],
  "hephaestus-forge": [false, false],
  "spear-camp": [true, false],
  watchtower: [false, true],
  "wolf-den": [true, false],
  woodcutter: [false, true],
  "drakon-nest": [true, false],
  "hesperides-tree": [false, false],
  "hall-of-rhapsodes": [true, true],
  "throne-of-zeus": [true, false],
  "misthophoros-camp": [true, false],
  "charons-barge": [true, false],
  "circle-of-stone": [false, true],
  forest: [false, false],
  mountain: [false, false],
} satisfies Record<CharmTarget, readonly [stat: boolean, currency: boolean]>;

export const sourceHasStatReceiver = (target: CharmTarget) =>
  receiverCapabilities[target][0];
export const sourceHasCurrencyReceiver = (target: CharmTarget) =>
  receiverCapabilities[target][1];

export function itemHolds(target: CharmTarget, holder: Holder) {
  const tags =
    target === "mountain" || target === "forest" || target === "circle-of-stone"
      ? featureTags[target]
      : buildings[target].tags;
  return holdsTags(tags, holder);
}

export function canCharmTarget(card: FateId, target: CharmTarget) {
  const fate = fates[card];
  const receiver =
    sourceHasStatReceiver(target) || sourceHasCurrencyReceiver(target);
  return (
    fate.kind === "rune" &&
    receiver &&
    !!fate.holders &&
    itemHolds(target, fate.holders)
  );
}

export function validFeatureRunes(
  runes: readonly (readonly [TileId, FateId])[],
  owned: readonly TileId[],
  featureAt: (tile: TileId) => Feature | null | undefined,
) {
  return (
    new Set(runes.map(([tile]) => tile)).size === runes.length &&
    runes.every(([tile, card]) => {
      const feature = featureAt(tile);
      return owned.includes(tile) && !!feature && canCharmTarget(card, feature);
    })
  );
}
