export const sourceBuild = "0.77.118d";
export const sourceEconomy = {
  "shopRerolls": [
    2,
    4,
    8,
    16,
    32,
    64
  ],
  "fateRerolls": [
    1,
    2,
    4,
    8,
    16,
    32,
    64
  ],
  "villagerBase": 4,
  "villagerIncrease": 3
} as const;
export const sourceRarityCosts = {
  "common": 4,
  "uncommon": 8,
  "rare": 12,
  "epic": 18,
  "legendary": 24
} as const;
export const sourceSeasonWeights = {
  "spring": [
    85.0,
    15.0,
    0.0,
    0.0,
    0.0
  ],
  "summer": [
    55.0,
    35.0,
    7.0,
    3.0,
    0.0
  ],
  "autumn": [
    25.0,
    45.0,
    23.0,
    5.0,
    2.0
  ],
  "winter": [
    15.0,
    20.0,
    25.0,
    25.0,
    15.0
  ]
} as const;
export const sourceItems = {
  "altar-of-kings": {
    "native": "AltarOfKings",
    "guid": "0d94793faee681b4998d86a0ee5e975c",
    "rarity": "legendary",
    "tags": [
      "divine",
      "support"
    ]
  },
  "forge": {
    "native": "Armory",
    "guid": "ddb004912bd1c7e42aa4714713e08301",
    "rarity": "uncommon",
    "tags": [
      "support",
      "civilian"
    ]
  },
  "javelin-camp": {
    "native": "AxeThrowersCamp",
    "guid": "9dd563dad3f16994ba38d1d84e2f023d",
    "rarity": "common",
    "tags": [
      "warband",
      "ranged",
      "unit"
    ]
  },
  "apollo-fountain": {
    "native": "BarentonFountain",
    "guid": "7aa216b7b28417d46881eec40f7bbb6c",
    "rarity": "common",
    "tags": [
      "divine",
      "knowledge"
    ]
  },
  "iris-bridge": {
    "native": "Bifrost",
    "guid": "7b98a8cb5b123af45aea5ef44f0e5b77",
    "rarity": "legendary",
    "tags": [
      "divine",
      "support"
    ]
  },
  "brewery": {
    "native": "Brewery",
    "guid": "9e0ffb83528a5ad4e99262e8f8ea7422",
    "rarity": "common",
    "tags": [
      "civilian",
      "knowledge"
    ]
  },
  "sacred-fire": {
    "native": "CeremonialBonfire",
    "guid": "2a281373209981b4ea7115d0cbb5c884",
    "rarity": "uncommon",
    "tags": [
      "divine",
      "support"
    ]
  },
  "defense-tower": {
    "native": "DefenseTower",
    "guid": "c5c04279b1ebb3f49b1b28a96dcdde83",
    "rarity": "common",
    "tags": [
      "ranged",
      "tower"
    ]
  },
  "tombs-of-erebus": {
    "native": "DraugrTombs",
    "guid": "c8a7fcd98b69e854ca56518832af1897",
    "rarity": "rare",
    "tags": [
      "mythical",
      "melee",
      "sacrificial",
      "unit"
    ]
  },
  "farm": {
    "native": "Farm",
    "guid": "4d7111bed71444e4c978f156e5cb4919",
    "rarity": "common",
    "tags": [
      "support",
      "civilian",
      "economy"
    ]
  },
  "gate-of-hades": {
    "native": "GatesOfHelheim",
    "guid": "7e124091ce0ef554aa006262605e5efd",
    "rarity": "epic",
    "tags": [
      "mythical",
      "melee",
      "unit"
    ]
  },
  "gate-of-etna": {
    "native": "GatesOfMuspell",
    "guid": "740584e2d895f3c4a84600e364bcf1f7",
    "rarity": "legendary",
    "tags": [
      "mythical",
      "melee",
      "unit"
    ]
  },
  "healers-hut": {
    "native": "HealersHut",
    "guid": "51541a06a392bae45affbb25c44ae00e",
    "rarity": "common",
    "tags": [
      "civilian",
      "nature",
      "healer",
      "unit"
    ]
  },
  "tritons-conch": {
    "native": "HeimdahlsHorn",
    "guid": "5ad98ce8b353ce24a923107a32de8f89",
    "rarity": "rare",
    "tags": [
      "divine",
      "support",
      "tower"
    ]
  },
  "altar-of-olympus": {
    "native": "Horgr",
    "guid": "15b10cc9af3b15648aaea803aa4f2064",
    "rarity": "rare",
    "tags": [
      "knowledge",
      "divine",
      "melee",
      "unit"
    ]
  },
  "house": {
    "native": "House",
    "guid": "1d44a158d13102f45a8a736c64d63f05",
    "rarity": "uncommon",
    "tags": [
      "support",
      "civilian"
    ]
  },
  "hunters-lodge": {
    "native": "HuntersLodge",
    "guid": "c7e4a86cd48c50446a5cf310bcb1f670",
    "rarity": "uncommon",
    "tags": [
      "civilian",
      "economy",
      "support"
    ]
  },
  "gigantes-camp": {
    "native": "JotunnCamp",
    "guid": "6111573360358ce47b9237ec5b9272d4",
    "rarity": "rare",
    "tags": [
      "mythical",
      "melee",
      "unit",
      "mercenary"
    ]
  },
  "dactyl-camp": {
    "native": "Kobold Camp",
    "guid": "31f0dd3498a91be49abb0a75d412d881",
    "rarity": "uncommon",
    "tags": [
      "mythical",
      "melee",
      "unit",
      "mercenary"
    ]
  },
  "agora": {
    "native": "Marketplace",
    "guid": "6f3f161f9db30c44f8e7009e9685bc40",
    "rarity": "uncommon",
    "tags": [
      "economy",
      "civilian"
    ]
  },
  "menders-hut": {
    "native": "MendersHut",
    "guid": "521984cb47c690d46937e00969692366",
    "rarity": "rare",
    "tags": [
      "civilian",
      "healer",
      "nature",
      "unit"
    ]
  },
  "spring-of-mnemosyne": {
    "native": "MimirsBrunn",
    "guid": "0f5d97476f37c5042ae74ac0f03018ad",
    "rarity": "rare",
    "tags": [
      "knowledge",
      "divine",
      "support"
    ]
  },
  "silver-mine": {
    "native": "Mine",
    "guid": "5bc652da5646ec24a8b2e8e10c193e42",
    "rarity": "common",
    "tags": [
      "civilian",
      "economy"
    ]
  },
  "thunderbolt-of-zeus": {
    "native": "Mjolnir",
    "guid": "fb772c64c0546c84fb8a4ad5889aa509",
    "rarity": "epic",
    "tags": [
      "divine",
      "tower"
    ]
  },
  "pit-of-tartarus": {
    "native": "Nastrond",
    "guid": "7a67edc9e0be9fb4cafc94b16e25aff3",
    "rarity": "rare",
    "tags": [
      "mythical",
      "support",
      "terrain"
    ]
  },
  "offering-well": {
    "native": "OfferingWell",
    "guid": "40bd634496b0b8640b8666133e928313",
    "rarity": "rare",
    "tags": [
      "economy",
      "support"
    ]
  },
  "scout-camp": {
    "native": "ScoutCamp",
    "guid": "c40cbae6af998b14abc6c7cad7f8bc1f",
    "rarity": "uncommon",
    "tags": [
      "civilian",
      "support"
    ]
  },
  "sentry-camp": {
    "native": "SentryCamp",
    "guid": "0c3994aa66f71e94b94a24fe3ef1a2a4",
    "rarity": "uncommon",
    "tags": [
      "warband",
      "melee",
      "unit"
    ]
  },
  "sheepfold": {
    "native": "SheepFold",
    "guid": "39e10ebd381e32f4a96fb54cb9691349",
    "rarity": "rare",
    "tags": [
      "economy",
      "knowledge",
      "civilian",
      "support"
    ]
  },
  "shield-camp": {
    "native": "ShieldsBearersCamp",
    "guid": "c35d010b19974c643836aaed7e8e6fad",
    "rarity": "common",
    "tags": [
      "warband",
      "melee",
      "unit"
    ]
  },
  "skull-of-typhon": {
    "native": "SkullOfHrungnir",
    "guid": "ce1142825cc8e064fb62380510a29997",
    "rarity": "epic",
    "tags": [
      "mythical",
      "melee",
      "unit"
    ]
  },
  "archer-camp": {
    "native": "TrackerCamp",
    "guid": "1d9347850d355424891d4c097a0ab140",
    "rarity": "uncommon",
    "tags": [
      "warband",
      "ranged",
      "unit"
    ]
  },
  "hephaestus-forge": {
    "native": "VolundsForge",
    "guid": "007b28b49e611bc41a9e6b62def9c4de",
    "rarity": "epic",
    "tags": [
      "support",
      "mythical"
    ]
  },
  "spear-camp": {
    "native": "WarriorCamp",
    "guid": "cae6662619a259847b5a99e73ec1ccde",
    "rarity": "common",
    "tags": [
      "warband",
      "melee",
      "unit"
    ]
  },
  "watchtower": {
    "native": "WatchTower",
    "guid": "5df7f50238e198844aa9c455ece72f57",
    "rarity": "uncommon",
    "tags": [
      "knowledge",
      "support",
      "tower"
    ]
  },
  "wolf-den": {
    "native": "WolfDen",
    "guid": "413cac423f15aea4f93acb30bf69c6b4",
    "rarity": "rare",
    "tags": [
      "beast",
      "nature",
      "melee",
      "unit"
    ]
  },
  "woodcutter": {
    "native": "Woodcutter",
    "guid": "306e7fd6ea851d649aee4af64ae337a4",
    "rarity": "common",
    "tags": [
      "civilian",
      "economy",
      "support"
    ]
  },
  "drakon-nest": {
    "native": "WyvernNest",
    "guid": "a76e8b8ef12b8ab4eaa5b1fddff48a35",
    "rarity": "epic",
    "tags": [
      "mythical",
      "ranged",
      "unit"
    ]
  },
  "hesperides-tree": {
    "native": "Yggdrasil",
    "guid": "8cb8047b9c0771a419dc5961570cab0c",
    "rarity": "legendary",
    "tags": [
      "divine",
      "support",
      "nature"
    ]
  },
  "hall-of-rhapsodes": {
    "native": "HallofSkalds",
    "guid": "76949c8e96838a54290059ec25aba609",
    "rarity": "uncommon",
    "tags": [
      "civilian",
      "healer",
      "knowledge",
      "unit"
    ]
  },
  "throne-of-zeus": {
    "native": "Hjildskjalf",
    "guid": "3d91688081501b342b125651ac16e218",
    "rarity": "epic",
    "tags": [
      "divine",
      "melee",
      "unit",
      "warband"
    ]
  },
  "misthophoros-camp": {
    "native": "MercenaryCamp",
    "guid": "bf373a48d82b71d45a415c6f3806aaeb",
    "rarity": "common",
    "tags": [
      "unit",
      "warband",
      "melee",
      "mercenary"
    ]
  },
  "charons-barge": {
    "native": "Naglfar",
    "guid": "3c4b934e973841e40a3496b58d8133be",
    "rarity": "epic",
    "tags": [
      "unit",
      "mythical",
      "melee",
      "mercenary"
    ]
  }
} as const;
export const sourceItemCosts = {
  "altar-of-kings": 24,
  "forge": 8,
  "javelin-camp": 4,
  "apollo-fountain": 4,
  "iris-bridge": 24,
  "brewery": 4,
  "sacred-fire": 8,
  "defense-tower": 4,
  "tombs-of-erebus": 12,
  "farm": 4,
  "gate-of-hades": 18,
  "gate-of-etna": 24,
  "healers-hut": 4,
  "tritons-conch": 12,
  "altar-of-olympus": 12,
  "house": 8,
  "hunters-lodge": 8,
  "gigantes-camp": 12,
  "dactyl-camp": 8,
  "agora": 8,
  "menders-hut": 12,
  "spring-of-mnemosyne": 12,
  "silver-mine": 4,
  "thunderbolt-of-zeus": 18,
  "pit-of-tartarus": 12,
  "offering-well": 12,
  "scout-camp": 8,
  "sentry-camp": 8,
  "sheepfold": 12,
  "shield-camp": 4,
  "skull-of-typhon": 18,
  "archer-camp": 8,
  "hephaestus-forge": 18,
  "spear-camp": 4,
  "watchtower": 8,
  "wolf-den": 12,
  "woodcutter": 4,
  "drakon-nest": 18,
  "hesperides-tree": 24,
  "hall-of-rhapsodes": 8,
  "throne-of-zeus": 18,
  "misthophoros-camp": 4,
  "charons-barge": 18
} as const;
export const sourceSpawn = {
  "aegeus": {
    "amount": 1,
    "cap": 1
  },
  "atalanta": {
    "amount": 1,
    "cap": 1
  },
  "hoplite": {
    "amount": 0,
    "cap": 99
  },
  "tracker": {
    "amount": 0,
    "cap": 99
  },
  "peltast": {
    "amount": 0,
    "cap": 99
  },
  "hypaspist": {
    "amount": 0,
    "cap": 99
  },
  "peripolos": {
    "amount": 0,
    "cap": 99
  },
  "misthophoros": {
    "amount": 0,
    "cap": 99
  },
  "spartoi": {
    "amount": 2,
    "cap": 99
  },
  "erinys": {
    "amount": 2,
    "cap": 99
  },
  "fire-titan": {
    "amount": 1,
    "cap": 99
  },
  "rhapsode": {
    "amount": 0,
    "cap": 99
  },
  "asclepiad": {
    "amount": 0,
    "cap": 99
  },
  "elysian-champion": {
    "amount": 0,
    "cap": 99
  },
  "shade": {
    "amount": 4,
    "cap": 99
  },
  "cyclops": {
    "amount": 1,
    "cap": 99
  },
  "dactyl": {
    "amount": 3,
    "cap": 99
  },
  "battle-physician": {
    "amount": 0,
    "cap": 99
  },
  "boreal-giant": {
    "amount": 1,
    "cap": 99
  },
  "drakon-colossus": {
    "amount": 0,
    "cap": 2
  },
  "arcadian-wolf": {
    "amount": 2,
    "cap": 99
  },
  "drakon": {
    "amount": 1,
    "cap": 99
  }
} as const;
export const sourceCampCounts = {
  "peripolos": {
    "coefficient": 1.0,
    "cap": 6.0
  },
  "misthophoros": {
    "coefficient": 0.1666666716337204,
    "cap": 4.0
  }
} as const;
// UnitSizeData size, _colliderRadius (Unity units) and _maxAttackers; UnitData._useProjectile.
export const sourceUnitBody = {
  "aegeus": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "atalanta": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "hoplite": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "tracker": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": true
  },
  "peltast": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": true
  },
  "hypaspist": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "peripolos": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "misthophoros": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "spartoi": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "erinys": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "fire-titan": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": false
  },
  "rhapsode": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "asclepiad": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "elysian-champion": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "shade": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "cyclops": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": false
  },
  "dactyl": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "battle-physician": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "boreal-giant": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": false
  },
  "drakon-colossus": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": false
  },
  "arcadian-wolf": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": false
  },
  "drakon": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": true
  },
  "fox": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "boar": {
    "size": "small",
    "radius": 0.5,
    "maxAttackers": 4,
    "projectile": false
  },
  "bear": {
    "size": "big",
    "radius": 0.75,
    "maxAttackers": 6,
    "projectile": false
  }
} as const;
const unitDefinitions = {
  "aegeus": {
    "health": {
      "base": 240.0,
      "perLevel": 0.0
    },
    "armor": {
      "base": 40.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 10.0,
      "perLevel": 0.0
    },
    "speed": {
      "base": 0.6499999761581421,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "atalanta": {
    "health": {
      "base": 200.0,
      "perLevel": 0.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 8.0,
      "perLevel": 0.0
    },
    "speed": {
      "base": 0.8999999761581421,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 15.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "hoplite": {
    "health": {
      "base": 45.0,
      "perLevel": 45.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 5.0,
      "perLevel": 5.0
    },
    "speed": {
      "base": 0.800000011920929,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "tracker": {
    "health": {
      "base": 45.0,
      "perLevel": 45.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 3.0,
      "perLevel": 3.0
    },
    "speed": {
      "base": 0.6000000238418579,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 6.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "peltast": {
    "health": {
      "base": 25.0,
      "perLevel": 25.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 8.0,
      "perLevel": 8.0
    },
    "speed": {
      "base": 0.4000000059604645,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 5.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "hypaspist": {
    "health": {
      "base": 30.0,
      "perLevel": 30.0
    },
    "armor": {
      "base": 50.0,
      "perLevel": 50.0
    },
    "damage": {
      "base": 5.0,
      "perLevel": 5.0
    },
    "speed": {
      "base": 0.4000000059604645,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "peripolos": {
    "health": {
      "base": 20.0,
      "perLevel": 20.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 3.0,
      "perLevel": 3.0
    },
    "speed": {
      "base": 0.6000000238418579,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "misthophoros": {
    "health": {
      "base": 60.0,
      "perLevel": 60.0
    },
    "armor": {
      "base": 15.0,
      "perLevel": 15.0
    },
    "damage": {
      "base": 7.0,
      "perLevel": 7.0
    },
    "speed": {
      "base": 0.6499999761581421,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 10.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "spartoi": {
    "health": {
      "base": 150.0,
      "perLevel": 150.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 8.0,
      "perLevel": 8.0
    },
    "speed": {
      "base": 0.6499999761581421,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 5.0,
      "perLevel": 5.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "erinys": {
    "health": {
      "base": 250.0,
      "perLevel": 250.0
    },
    "armor": {
      "base": 50.0,
      "perLevel": 50.0
    },
    "damage": {
      "base": 15.0,
      "perLevel": 15.0
    },
    "speed": {
      "base": 0.699999988079071,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 5.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "fire-titan": {
    "health": {
      "base": 750.0,
      "perLevel": 750.0
    },
    "armor": {
      "base": 300.0,
      "perLevel": 300.0
    },
    "damage": {
      "base": 20.0,
      "perLevel": 20.0
    },
    "speed": {
      "base": 0.5,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 2.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 10.0,
      "perLevel": 10.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 8.0,
      "perLevel": 1.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "rhapsode": {
    "health": {
      "base": 25.0,
      "perLevel": 25.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "speed": {
      "base": 0.699999988079071,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 6.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 15.0,
      "perLevel": 15.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "asclepiad": {
    "health": {
      "base": 35.0,
      "perLevel": 35.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "speed": {
      "base": 0.4000000059604645,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 6.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 10.0,
      "perLevel": 10.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "elysian-champion": {
    "health": {
      "base": 200.0,
      "perLevel": 200.0
    },
    "armor": {
      "base": 30.0,
      "perLevel": 30.0
    },
    "damage": {
      "base": 12.0,
      "perLevel": 12.0
    },
    "speed": {
      "base": 0.699999988079071,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "shade": {
    "health": {
      "base": 45.0,
      "perLevel": 45.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 5.0,
      "perLevel": 5.0
    },
    "speed": {
      "base": 0.699999988079071,
      "perLevel": 0.0
    },
    "movement": {
      "base": 4.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "cyclops": {
    "health": {
      "base": 550.0,
      "perLevel": 550.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 10.0,
      "perLevel": 10.0
    },
    "speed": {
      "base": 0.5,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 2.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 3.0,
      "perLevel": 1.0
    },
    "stun": {
      "base": 0.4000000059604645,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "dactyl": {
    "health": {
      "base": 30.0,
      "perLevel": 30.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 5.0,
      "perLevel": 5.0
    },
    "speed": {
      "base": 0.5,
      "perLevel": 0.0
    },
    "movement": {
      "base": 4.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "battle-physician": {
    "health": {
      "base": 60.0,
      "perLevel": 60.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "speed": {
      "base": 0.699999988079071,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 4.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 10.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 15.0,
      "perLevel": 15.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "boreal-giant": {
    "health": {
      "base": 350.0,
      "perLevel": 350.0
    },
    "armor": {
      "base": 100.0,
      "perLevel": 100.0
    },
    "damage": {
      "base": 20.0,
      "perLevel": 20.0
    },
    "speed": {
      "base": 0.4000000059604645,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.0,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.5,
      "perLevel": 0.0
    },
    "crit": {
      "base": 10.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 3.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "drakon-colossus": {
    "health": {
      "base": 500.0,
      "perLevel": 500.0
    },
    "armor": {
      "base": 100.0,
      "perLevel": 100.0
    },
    "damage": {
      "base": 55.0,
      "perLevel": 55.0
    },
    "speed": {
      "base": 0.6000000238418579,
      "perLevel": 0.0
    },
    "movement": {
      "base": 2.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 2.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 25.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "arcadian-wolf": {
    "health": {
      "base": 125.0,
      "perLevel": 125.0
    },
    "armor": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "damage": {
      "base": 8.0,
      "perLevel": 8.0
    },
    "speed": {
      "base": 0.800000011920929,
      "perLevel": 0.0
    },
    "movement": {
      "base": 4.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 1.5,
      "perLevel": 0.0
    },
    "crit": {
      "base": 15.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  },
  "drakon": {
    "health": {
      "base": 200.0,
      "perLevel": 200.0
    },
    "armor": {
      "base": 300.0,
      "perLevel": 300.0
    },
    "damage": {
      "base": 10.0,
      "perLevel": 10.0
    },
    "speed": {
      "base": 0.5,
      "perLevel": 0.0
    },
    "movement": {
      "base": 3.5,
      "perLevel": 0.0
    },
    "range": {
      "base": 10.0,
      "perLevel": 0.0
    },
    "crit": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "burn": {
      "base": 10.0,
      "perLevel": 10.0
    },
    "poison": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "healing": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "revive": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "cleave": {
      "base": 6.0,
      "perLevel": 1.0
    },
    "stun": {
      "base": 0.0,
      "perLevel": 0.0
    },
    "frost": {
      "base": 0.0,
      "perLevel": 0.0
    }
  }
} as const;

export function sourceUnit(id: keyof typeof unitDefinitions, level: number) {
  const values = unitDefinitions[id];
  function stat(name: keyof typeof values) {
    const definition = values[name];
    const base = definition.base;
    if (level <= 1) return base;
    const growth = Math.fround((level - 1) * definition.perLevel);
    return Math.fround(base + growth);
  }
  return {
    health: stat("health"), armor: stat("armor"), damage: stat("damage"),
    speed: stat("speed"), movement: stat("movement"), range: stat("range"),
    crit: stat("crit"), burn: stat("burn"), poison: stat("poison"),
    healing: stat("healing"), revive: stat("revive"), cleave: stat("cleave"),
    stun: stat("stun"), frost: stat("frost"),
  };
}
