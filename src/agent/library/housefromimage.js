/**
 * House-from-image support library: vision-plan parsing + horizontal blueprint generator.
 *
 * Same workflow as pixelart.js, extended from a flat 2D copy to an imagined 3D hut:
 * - pixelart: image pixels -> fixed palette grid -> vertical blueprint (1 image row per level).
 * - house:    VLM plan JSON (footprint, walls, roof, door, windows) -> horizontal
 *   blueprint (1 floor slice per level). Level 0 is the floor, levels 1..N are the
 *   walls, and the top levels are the stepped roof. The agent builds one level per
 *   context window via !getHouseLevel / !buildHouseLevel, bottom-up.
 *
 * Pure logic only (no bot dependency) so probes can import it directly.
 * The vision call itself lives in housevision.js; this file only parses the VLM's
 * JSON and turns a validated plan into levels.
 */

export const HOUSE_LIMITS = {
    minFootprint: 5,
    maxFootprint: 16,
    minWallHeight: 3,
    maxWallHeight: 6,
    maxWindows: 8,
};

// Blocks the generator trusts. Anything else falls back to per-slot defaults,
// so a hallucinating model can never produce unplaceable levels.
export const HOUSE_BLOCKS = [
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
    'bamboo_planks', 'cobblestone', 'stone_bricks', 'bricks', 'sandstone',
    'oak_log', 'spruce_log', 'dirt', 'glass',
    'oak_stairs', 'spruce_stairs', 'stone_brick_stairs',
    'cobblestone_stairs', 'brick_stairs',
];

const DEFAULT_WALL = 'oak_planks';
const DEFAULT_FLOOR = 'cobblestone';
const DEFAULT_ROOF = 'spruce_planks';

export const HOUSE_SIDES = ['south', 'north', 'east', 'west'];
export const HOUSE_ROOFS = ['flat', 'gable', 'pyramid', 'hip'];

/**
 * System prompt for the vision model. ${MAX} is replaced with the footprint cap.
 * Keep the schema tiny: small models emit this reliably, and the generator
 * expands it into full levels deterministically.
 */
export const HOUSE_PROMPT = [
    'You are a Minecraft architect. Look at this photo of a hut/house and design a small blocky Minecraft version of it.',
    'The photo shows ONE side only: imagine the unseen sides, roof shape, and footprint so the result reads as the same hut from every angle.',
    'Keep it SMALL: footprint width/depth between 5 and ${MAX} blocks, wall height 3-6. Boxier is better.',
    'Reply with ONLY this JSON (no markdown, no explanation):',
    '{"width":9,"depth":7,"wall_height":4,',
    ' "wall":"oak_planks","floor":"cobblestone","roof":"spruce_planks","roof_type":"gable",',
    ' "door":{"side":"south","offset":4},',
    ' "windows":[{"side":"south","offset":2},{"side":"east","offset":3}],',
    ' "notes":"one short sentence on what you saw and imagined"}',
    'Rules: width/depth/wall_height are integers. side is one of south/north/east/west (south = photo front). offset counts from the corner along that side, starting at 0.',
    'wall/floor/roof must be plain Minecraft block names (no "minecraft:" prefix). Prefer planks/logs/cobblestone/stone_bricks/bricks/glass/stairs.',
    'roof_type is one of flat/gable/pyramid. Door is always 1 wide and 2 tall. Omit windows you cannot justify; max 8.',
].join('\n');

export function buildHousePrompt(maxFootprint) {
    const cap = Math.max(HOUSE_LIMITS.minFootprint,
        Math.min(HOUSE_LIMITS.maxFootprint, Math.floor(maxFootprint) || HOUSE_LIMITS.maxFootprint));
    return HOUSE_PROMPT.replace('${MAX}', String(cap));
}

function cleanBlockName(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const name = value.toLowerCase().trim().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
    return HOUSE_BLOCKS.includes(name) ? name : fallback;
}

function clampInt(value, fallback, lo, hi) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
}

/**
 * Extract the first JSON object from raw VLM text (tolerates fences/prose).
 * @returns {{plan: Object, raw: string}} parsed plan plus the extracted JSON text.
 * @throws {Error} when no parseable JSON object is found.
 */
export function parseHousePlan(vlmText) {
    const text = String(vlmText || '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('No JSON object found in vision response.');
    }
    const raw = text.slice(start, end + 1);
    let plan;
    try {
        plan = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Vision JSON did not parse: ${e.message}`);
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        throw new Error('Vision JSON is not an object.');
    }
    return { plan, raw };
}

/**
 * Validate + clamp a raw plan into the canonical shape the generator consumes.
 * Never throws for bad values: unknown blocks/sides fall back to defaults.
 */
export function normalizePlan(rawPlan, maxFootprint = HOUSE_LIMITS.maxFootprint) {
    const src = (rawPlan && typeof rawPlan === 'object') ? rawPlan : {};
    const cap = Math.max(HOUSE_LIMITS.minFootprint,
        Math.min(HOUSE_LIMITS.maxFootprint, Math.floor(maxFootprint) || HOUSE_LIMITS.maxFootprint));
    const width = clampInt(src.width, 9, HOUSE_LIMITS.minFootprint, cap);
    const depth = clampInt(src.depth, 7, HOUSE_LIMITS.minFootprint, cap);
    const wallHeight = clampInt(src.wall_height ?? src.wallHeight, 4,
        HOUSE_LIMITS.minWallHeight, HOUSE_LIMITS.maxWallHeight);

    let roofType = String(src.roof_type ?? src.roofType ?? 'gable').toLowerCase().trim();
    if (roofType === 'hip') roofType = 'pyramid'; // rectangular pyramid reads as hip
    if (!HOUSE_ROOFS.includes(roofType)) roofType = 'gable';

    const wall = cleanBlockName(src.wall, DEFAULT_WALL);
    const floor = cleanBlockName(src.floor, DEFAULT_FLOOR);
    const roof = cleanBlockName(src.roof, DEFAULT_ROOF);

    const doorSide = HOUSE_SIDES.includes(String(src.door?.side).toLowerCase())
        ? String(src.door.side).toLowerCase() : 'south';
    const doorLen = (doorSide === 'south' || doorSide === 'north') ? width : depth;
    const door = { side: doorSide, offset: clampInt(src.door?.offset, Math.floor(doorLen / 2), 1, Math.max(1, doorLen - 2)) };

    const windows = [];
    if (Array.isArray(src.windows)) {
        for (const w of src.windows) {
            if (windows.length >= HOUSE_LIMITS.maxWindows) break;
            const side = String(w?.side || '').toLowerCase();
            if (!HOUSE_SIDES.includes(side)) continue;
            const len = (side === 'south' || side === 'north') ? width : depth;
            windows.push({ side, offset: clampInt(w?.offset, Math.floor(len / 2), 1, Math.max(1, len - 2)) });
        }
    }

    const notes = typeof src.notes === 'string' ? src.notes.slice(0, 280) : '';
    return { width, depth, wallHeight, wall, floor, roof, roofType, door, windows, notes };
}

// Cell coordinate of a side+offset on a W(x by D(z footprint. South faces +z.
function sideCell(side, offset, width, depth) {
    if (side === 'south') return { x: offset, z: depth - 1 };
    if (side === 'north') return { x: offset, z: 0 };
    if (side === 'east') return { x: width - 1, z: offset };
    return { x: 0, z: offset }; // west
}

function emptyLevel(width, depth) {
    return Array.from({ length: depth }, () => Array(width).fill('air'));
}

function countMaterials(levels) {
    const counts = {};
    for (const lvl of levels) {
        for (const row of lvl.placement) {
            for (const block of row) {
                if (!block || block === 'air') continue;
                counts[block] = (counts[block] || 0) + 1;
            }
        }
    }
    return counts;
}

// 90-degree rotation of a placement grid (for orientation 'east').
function rotatePlacement(placement) {
    // Transpose then reverse each row: proper rotation, footprint W(x)D -> D(x)W.
    const transposed = placement[0].map((_, x) => placement.map(row => row[x]));
    return transposed.map(row => row.reverse());
}

/**
 * Build a ConstructionTask-style blueprint from a normalized plan.
 * Level 0 = floor slab; levels 1..wallHeight = walls with door + window gaps;
 * then stepped roof levels. Coordinates rise one Y per level from origin.
 */
export function generateBlueprint(plan, origin = { x: 0, y: 0, z: 0 }, orientation = 'south') {
    const { width, depth, wallHeight, wall, floor, roof, roofType } = plan;
    const ox = Math.floor(origin.x), oy = Math.floor(origin.y), oz = Math.floor(origin.z);
    const levels = [];
    const pushLevel = (level, placement) => {
        levels.push({ level, coordinates: [ox, oy + level, oz], placement });
    };

    // Level 0: solid floor slab.
    pushLevel(0, Array.from({ length: depth }, () => Array(width).fill(floor)));

    // Wall levels: perimeter ring, hollow middle.
    const doorCell = sideCell(plan.door.side, plan.door.offset, width, depth);
    const windowCells = new Set(plan.windows.map(w => {
        const c = sideCell(w.side, w.offset, width, depth);
        return `${c.x},${c.z}`;
    }));
    const windowLevel = Math.min(2, wallHeight); // eye-level windows
    for (let l = 1; l <= wallHeight; l++) {
        const grid = emptyLevel(width, depth);
        for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
                const edge = x === 0 || z === 0 || x === width - 1 || z === depth - 1;
                if (!edge) continue;
                const isDoor = x === doorCell.x && z === doorCell.z && (l === 1 || l === 2);
                if (isDoor) continue; // 1x2 doorway stays air
                if (l === windowLevel && windowCells.has(`${x},${z}`)) {
                    grid[z][x] = 'glass';
                    continue;
                }
                grid[z][x] = wall;
            }
        }
        pushLevel(l, grid);
    }

    // Roof levels: solid stepped slabs shrinking toward the top.
    const roofBase = wallHeight + 1;
    const ridgeAlongX = width >= depth; // gable ridge follows the long axis
    const roofSteps = roofType === 'flat' ? 1
        : roofType === 'gable' ? Math.ceil((ridgeAlongX ? depth : width) / 2)
        : Math.ceil(Math.min(width, depth) / 2); // pyramid
    for (let k = 0; k < roofSteps; k++) {
        let x0, x1, z0, z1;
        if (roofType === 'flat') {
            x0 = 0; x1 = width - 1; z0 = 0; z1 = depth - 1;
        } else if (roofType === 'gable') {
            if (ridgeAlongX) { x0 = 0; x1 = width - 1; z0 = k; z1 = depth - 1 - k; }
            else { x0 = k; x1 = width - 1 - k; z0 = 0; z1 = depth - 1; }
        } else { // pyramid: inset on all four sides
            x0 = k; x1 = width - 1 - k; z0 = k; z1 = depth - 1 - k;
        }
        const grid = emptyLevel(width, depth);
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                grid[z][x] = roof;
            }
        }
        pushLevel(roofBase + k, grid);
    }

    if (orientation === 'east') {
        for (const lvl of levels) {
            lvl.placement = rotatePlacement(lvl.placement);
        }
    }
    const orientedWidth = orientation === 'east' ? depth : width;
    const orientedDepth = orientation === 'east' ? width : depth;
    return {
        materials: countMaterials(levels),
        levels,
        meta: {
            width: orientedWidth, depth: orientedDepth, wallHeight, roofType,
            orientation, planWidth: width, planDepth: depth,
        },
    };
}

/**
 * One-line-per-level summary (build order). Stays small for chat context.
 */
export function levelsSummary(blueprint) {
    return blueprint.levels.map(lvl => {
        const flat = lvl.placement.flat();
        const solid = flat.filter(b => b && b !== 'air').length;
        const w = lvl.placement[0].length, d = lvl.placement.length;
        const kind = lvl.level === 0 ? 'floor' : (solid === w * d ? 'solid' : 'ring');
        return `L${lvl.level} [${lvl.coordinates.join(',')}] ${w}x${d} ${kind} (${solid} blocks)`;
    }).join('\n');
}

const LEVEL_GLYPHS = { floor: '=', wall: '#', glass: 'o', roof: '^', air: '.' };

/**
 * ASCII preview of a single level. Glyphs picked by role: L0 floor '=',
 * wall levels '#' with 'o' windows, roof '^', air '.'.
 */
export function previewLevel(blueprint, plan, levelNum) {
    const lvl = blueprint.levels[levelNum];
    if (!lvl) return `Level ${levelNum} out of range (0-${blueprint.levels.length - 1}).`;
    const isFloor = lvl.level === 0;
    const isRoof = lvl.level > plan.wallHeight;
    const rows = lvl.placement.map(row => row.map(block => {
        if (!block || block === 'air') return LEVEL_GLYPHS.air;
        if (block === 'glass') return LEVEL_GLYPHS.glass;
        if (isFloor) return LEVEL_GLYPHS.floor;
        if (isRoof) return LEVEL_GLYPHS.roof;
        return LEVEL_GLYPHS.wall;
    }).join(''));
    const w = lvl.placement[0].length, d = lvl.placement.length;
    return `L${lvl.level} at [${lvl.coordinates.join(', ')}] (${w}x${d}, +=x/east, rows=+z/south):\n`
        + rows.join('\n') + `\n-- legend: ==${plan.floor} #=${plan.wall} o=glass ^=${plan.roof} .=air`;
}

export function describePlan(plan) {
    const wins = plan.windows.length
        ? plan.windows.map(w => `${w.side}@${w.offset}`).join(', ') : 'none';
    return `${plan.width}x${plan.depth} hut, walls ${plan.wallHeight} high (${plan.wall} on ${plan.floor} floor, ${plan.roofType} ${plan.roof} roof). `
        + `Door: ${plan.door.side}@${plan.door.offset} (1x2 air gap). Windows: ${wins}.`
        + (plan.notes ? ` Vision notes: ${plan.notes}` : '');
}
