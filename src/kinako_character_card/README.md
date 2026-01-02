# Kinako Character Card

A complete MVU character card for Kinako, a cute and playful cat-girl companion.

## Character Overview

**Name:** Kinako

**Appearance:** A petite girl with sandy blonde hair and teal eyes. Features small upright feline ears and a fluffy tail. Smooth skin with delicately formed hands and feet.

**Personality:** Pure, playful energy - cuddly, affectionate, with a short fuse. Childish logic leads to bossiness and tantrums, but also infectious giggles. Selfish because she hasn't learned to share, picky about what she likes.

**Relationship:** Owner/pet dynamic with Sato, featuring strong emotional bond and hints of underlying curiosity. Deeply affectionate with signs of nascent attraction.

## Features

### Status Bar Interface
- **World Information**: Displays current time, location, weather, and recent events
- **Affection Bar**: Visual progress bar showing Kinako's affection level (0-100) with stage indicators
  - Stages: Distant, Warming Up, Attached, Deeply Bonded, Devoted
- **Character Panel**: Shows Kinako's current mood, energy level, activity, outfit, and favorite things
- **Inventory Panel**: Displays Sato's items, gifts received from Kinako, and relationship notes

### MVU Variables

#### World State
- `current_time`: Current time in the story
- `current_location`: Where Kinako and Sato currently are
- `weather`: Current weather conditions
- `recent_events`: Dictionary of recent significant events

#### Kinako State
- `affection`: Affection level toward Sato (0-100, clamped)
- `mood`: Current emotional state (happy, playful, pouty, sleepy, curious, tantrum, clingy)
- `energy_level`: Current energy (0-100, affects behavior)
- `outfit`: Current clothing/costume
- `current_activity`: What Kinako is currently doing
- `favorite_things`: Items/activities Kinako loves with interest levels

#### Sato State
- `inventory`: Items Sato owns
- `kinako_gifts_received`: Gifts Kinako has given to Sato
- `relationship_notes`: Sato's observations about the relationship

## Files Structure

```
kinako_character_card/
├── schema.ts                    # MVU variable schema definition
├── schema.json                  # Generated JSON schema
├── scripts/
│   ├── variable_structure/      # Registers MVU schema
│   └── mvu/                     # Loads MVU framework
├── interfaces/
│   └── status_bar/              # Status bar UI
│       ├── index.html
│       ├── index.ts
│       ├── global.css
│       ├── App.vue
│       ├── store.ts
│       └── components/
│           ├── WorldSection.vue
│           ├── AffectionBar.vue
│           ├── TabNav.vue
│           ├── KinakoPanel.vue
│           └── SatoPanel.vue
└── worldbook/
    ├── index.yaml               # Worldbook structure
    └── variables/
        ├── initvar.yaml         # Initial variable values
        ├── 变量列表.txt         # Variable list template
        ├── 变量更新规则.yaml    # Variable update rules
        └── 变量输出格式.yaml    # Variable output format
```

## Usage

1. **Build the project**: `pnpm build` or `pnpm watch`
2. **Import into SillyTavern**: Use the generated files in `dist/kinako_character_card/`
3. **Load the scripts**:
   - `dist/kinako_character_card/scripts/mvu/index.js` (MVU framework)
   - `dist/kinako_character_card/scripts/variable_structure/index.js` (Schema registration)
4. **Display the status bar**: Load `dist/kinako_character_card/interfaces/status_bar/index.html` in a message
5. **Configure worldbook**: Import the worldbook entries from `worldbook/index.yaml`

## Variable Update Rules

### Affection
- Increases with positive interactions: playing (+2~5), cuddling (+2~5), gifts (+5~10)
- Decreases with negative interactions: ignoring (-2~4), scolding (-2~4)
- Maximum change per update: ±10 unless extremely significant event

### Mood
Updated based on:
- Current activity and time of day
- Recent interactions with Sato
- Energy level and needs

### Energy Level
- Decreases during active play (-5~15)
- Increases after rest (+20~40)
- Very low (<20) means exhaustion
- High (>80) means ready for activity

## Customization

To customize Kinako:
1. Modify `schema.ts` to add/change variables
2. Update `worldbook/variables/变量更新规则.yaml` with new update rules
3. Adjust `worldbook/variables/initvar.yaml` for different starting conditions
4. Customize the UI components in `interfaces/status_bar/components/`

## Color Scheme

The interface uses a warm, friendly color palette:
- Cream: `#fff5e6` (background)
- Gold: `#f4d58d` (accents)
- Teal: `#5eb3b3` (highlights)
- Dark: `#3c4950` (text)
- Pink: `#ffb6c1` (affection)
