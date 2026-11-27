/**
 * Facade-capture house builder: exact 2D front transcription + imagined shell.
 *
 * v1 drew a parametric hut (one wall block, one roof block) and lost every
 * surface detail. This module inverts the work split to match each side's
 * strength:
 * - CODE transcribes the photo front deterministically (crop -> resize ->
 *   color-bucket grid -> background flood-fill -> block map). Every pixel of
 *   the 2D view survives: timber beams, moss patches, battlements, trim.
 * - VLM does what only it can: pick the crop, map color buckets to real
 *   blocks, and imagine depth, sides, back, and roof style.
 *
 * Buckets are color-space anchors, NOT texture claims: the VLM maps each used
 * bucket to a real block, so approximate RGBs are fine. Unknown blocks fall
 * back to the bucket default and can never break a build.
 *
 * Pure logic only (no bot, no canvas) so probes can import it directly.
 * Canvas + vision calls live in housevision.js. Output levels use the same
 * {level, coordinates, placement} shape as pixelart/housefromimage, so the
 * one-level-per-window build commands work unchanged.
 */
import { levelsSummary } from './housefromimage.js';

export const FACADE_BUCKETS = [
    { name: 'white', rgb: [233, 236, 236], block: 'white_concrete', glyph: 'W' },
    { name: 'light_gray', rgb: [157, 157, 151], block: 'light_gray_concrete', glyph: 'l' },
    { name: 'gray', rgb: [99, 95, 98], block: 'gray_concrete', glyph: 'g' },
    { name: 'black', rgb: [29, 29, 33], block: 'black_concrete', glyph: 'K' },
    { name: 'brown', rgb: [96, 59, 31], block: 'brown_concrete', glyph: 'N' },
    { name: 'red', rgb: [149, 34, 33], block: 'red_concrete', glyph: 'R' },
    { name: 'orange', rgb: [224, 97, 0], block: 'orange_concrete', glyph: 'O' },
    { name: 'yellow', rgb: [240, 175, 21], block: 'yellow_concrete', glyph: 'Y' },
    { name: 'lime', rgb: [112, 185, 26], block: 'lime_concrete', glyph: 'L' },
    { name: 'green', rgb: [84, 109, 27], block: 'green_concrete', glyph: 'G' },
    { name: 'cyan', rgb: [21, 119, 136], block: 'cyan_concrete', glyph: 'C' },
    { name: 'light_blue', rgb: [58, 175, 217], block: 'light_blue_concrete', glyph: 'S' },
    { name: 'blue', rgb: [53, 57, 157], block: 'blue_concrete', glyph: 'B' },
    { name: 'purple', rgb: [122, 47, 188], block: 'purple_concrete', glyph: 'P' },
    { name: 'magenta', rgb: [189, 68, 179], block: 'magenta_concrete', glyph: 'M' },
    { name: 'pink', rgb: [238, 157, 195], block: 'pink_concrete', glyph: 'p' },
    // Building-tone anchors the concrete set misses (moss, timber, dark stone).
    { name: 'moss', rgb: [100, 115, 75], block: 'mossy_stone_bricks', glyph: 'm' },
    { name: 'bark', rgb: [115, 90, 55], block: 'oak_log', glyph: 'b' },
    { name: 'stone_dark', rgb: [72, 72, 76], block: 'cobblestone', glyph: 'd' },
    { name: 'cream', rgb: [212, 202, 182], block: 'sandstone', glyph: 'c' },
];

export const FACADE_LIMITS = {
    minWidth: 12,
    maxWidth: 32,
    maxHeight: 40,
    minDepth: 5,
    maxDepth: 10,
    maxWindows: 8,
};

// Placeable-via-/setblock blocks. No doors/torches/vines/leaves: they need
// support or multi-block state and pop or break when set directly.
export const FACADE_BLOCKS = [
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    'acacia_planks', 'dark_oak_planks', 'oak_log', 'spruce_log',
    'stone', 'cobblestone', 'stone_bricks', 'mossy_stone_bricks',
    'cracked_stone_bricks', 'chiseled_stone_bricks', 'bricks', 'sandstone',
    'oak_stairs', 'spruce_stairs', 'stone_brick_stairs', 'cobblestone_stairs',
    'brick_stairs', 'oak_slab', 'stone_brick_slab', 'cobblestone_slab',
    'oak_fence', 'spruce_fence', 'cobblestone_wall', 'stone_brick_wall',
    'glass', 'glass_pane', 'barrel', 'bookshelf', 'hay_block',
    'white_concrete', 'light_gray_concrete', 'gray_concrete', 'black_concrete',
    'brown_concrete', 'red_concrete', 'orange_concrete', 'yellow_concrete',
    'lime_concrete', 'green_concrete', 'cyan_concrete', 'light_blue_concrete',
    'blue_concrete', 'purple_concrete', 'magenta_concrete', 'pink_concrete',
];

function colorDistanceSq(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

export function nearestBucketIndex(r, g, b) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < FACADE_BUCKETS.length; i++) {
        const d = colorDistanceSq([r, g, b], FACADE_BUCKETS[i].rgb);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

export function cleanFacadeBlock(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const name = value.toLowerCase().trim().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
    return FACADE_BLOCKS.includes(name) ? name : fallback;
}

/**
 * Quantize raw RGBA pixels to bucket indices. Transparent -> -1 (air).
 */
export function quantizePixelsToBuckets(pixels, width, height) {
    const grid = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (pixels[o + 3] < 128) { row.push(-1); continue; }
            row.push(nearestBucketIndex(pixels[o], pixels[o + 1], pixels[o + 2]));
        }
        grid.push(row);
    }
    return grid;
}

/**
 * Turn photo backdrop into air: buckets covering >=15% of the border are
 * treated as background and flood-filled inward from the edges. Interior
 * cells of the same bucket survive (e.g. grey stone enclosed by timber).
 * Aborts (returns the grid unchanged) if it would erase >90%.
 * @returns {{grid: number[][], removed: number}} new grid + air fraction added.
 */
export function floodFillBackground(bucketGrid) {
    const H = bucketGrid.length, W = bucketGrid[0].length;
    const borderLen = 2 * W + 2 * H - 4;
    const counts = new Map();
    const at = (x, y) => bucketGrid[y][x];
    for (let x = 0; x < W; x++) {
        for (const y of [0, H - 1]) {
            const b = at(x, y);
            if (b !== -1) counts.set(b, (counts.get(b) || 0) + 1);
        }
    }
    for (let y = 1; y < H - 1; y++) {
        for (const x of [0, W - 1]) {
            const b = at(x, y);
            if (b !== -1) counts.set(b, (counts.get(b) || 0) + 1);
        }
    }
    const bg = new Set([...counts.entries()]
        .filter(([, c]) => c >= 0.15 * borderLen).map(([b]) => b));
    if (bg.size === 0) return { grid: bucketGrid.map(r => [...r]), removed: 0 };
    const grid = bucketGrid.map(r => [...r]);
    const queue = [];
    const push = (x, y) => {
        if (grid[y][x] !== -1 && bg.has(grid[y][x])) {
            grid[y][x] = -1;
            queue.push([x, y]);
        }
    };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { push(0, y); push(W - 1, y); }
    while (queue.length > 0) {
        const [x, y] = queue.pop();
        if (x > 0) push(x - 1, y);
        if (x < W - 1) push(x + 1, y);
        if (y > 0) push(x, y - 1);
        if (y < H - 1) push(x, y + 1);
    }
    let removed = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (grid[y][x] === -1 && bucketGrid[y][x] !== -1) removed++;
        }
    }
    if (removed / (W * H) > 0.9) {
        return { grid: bucketGrid.map(r => [...r]), removed: 0 }; // safety abort
    }
    return { grid, removed: removed / (W * H) };
}

/**
 * Remove all-air border rows/columns (leftover sky, ground, margins).
 * @returns {{grid, top, left}} trimmed grid + offsets into the original grid,
 * so block-space coords (door, window rects, wall split) can be shifted back.
 */
export function trimAirBorders(bucketGrid) {
    let top = 0, bottom = bucketGrid.length - 1;
    let left = 0, right = bucketGrid[0].length - 1;
    const rowAir = (y) => bucketGrid[y].every(c => c === -1);
    const colAir = (x) => bucketGrid.every(row => row[x] === -1);
    while (top <= bottom && rowAir(top)) top++;
    while (bottom >= top && rowAir(bottom)) bottom--;
    while (left <= right && colAir(left)) left++;
    while (right >= left && colAir(right)) right--;
    if (top > bottom || left > right) {
        return { grid: bucketGrid.map(r => [...r]), top: 0, left: 0 }; // all air: keep
    }
    const grid = [];
    for (let y = top; y <= bottom; y++) grid.push(bucketGrid[y].slice(left, right + 1));
    return { grid, top, left };
}

/**
 * Kill single/pair noise pixels: a color cell with fewer than 2 same-bucket
 * 4-neighbors adopts the bucket shared by 2+ neighbors. Air is untouched.
 * Reads from the original grid (single pass, no cascade).
 */
export function despeckle(bucketGrid) {
    const H = bucketGrid.length, W = bucketGrid[0].length;
    const out = bucketGrid.map(r => [...r]);
    const neighbors = (x, y) => {
        const cells = [];
        if (x > 0) cells.push(bucketGrid[y][x - 1]);
        if (x < W - 1) cells.push(bucketGrid[y][x + 1]);
        if (y > 0) cells.push(bucketGrid[y - 1][x]);
        if (y < H - 1) cells.push(bucketGrid[y + 1][x]);
        return cells;
    };
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const cur = bucketGrid[y][x];
            if (cur === -1) continue;
            const nb = neighbors(x, y);
            if (nb.filter(v => v === cur).length >= 2) continue;
            const counts = new Map();
            for (const v of nb) {
                if (v === -1 || v === cur) continue;
                counts.set(v, (counts.get(v) || 0) + 1);
            }
            for (const [v, c] of counts.entries()) {
                if (c >= 2) { out[y][x] = v; break; }
            }
        }
    }
    return out;
}

/**
 * Map a bucket grid to blocks via the VLM legend. Unmapped buckets use
 * their default block; unknown block names fall back the same way.
 * @returns {{blockGrid: string[][], legend: Object}} blocks + bucket->block used.
 */
export function mapGridToBlocks(bucketGrid, materials = {}) {
    const legend = {};
    for (const b of FACADE_BUCKETS) {
        legend[b.name] = cleanFacadeBlock(materials[b.name], b.block);
    }
    const blockGrid = bucketGrid.map(row => row.map(idx =>
        idx === -1 ? 'air' : legend[FACADE_BUCKETS[idx].name]));
    return { blockGrid, legend };
}

const FACADE_SIDES = ['east', 'west', 'north']; // front (south) comes from the photo

function clampInt(value, fallback, lo, hi) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
}

function clampFrac(value, fallback, lo, hi) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
}

function bucketTable() {
    return FACADE_BUCKETS.map(b => `${b.name}=${b.block}`).join(' ');
}

export function buildFacadePrompt(maxWidth) {
    const cap = Math.max(FACADE_LIMITS.minWidth,
        Math.min(FACADE_LIMITS.maxWidth, Math.floor(maxWidth) || FACADE_LIMITS.maxWidth));
    return [
        'You are a Minecraft architect. This photo shows ONE building. I will transcribe its FRONT pixel-by-pixel; you direct the transcription and imagine everything the photo hides.',
        'Reply with ONLY this JSON (no markdown, no explanation):',
        '{"crop":{"x":0.05,"y":0.1,"w":0.9,"h":0.75},"width":24,"wall_top":0.42,',
        ' "materials":{"gray":"stone_bricks","moss":"mossy_stone_bricks","bark":"oak_log","black":"cobblestone"},',
        ' "floor":"oak_planks","depth":7,"door":{"offset":12},',
        ' "front_windows":[{"x0":5,"y0":9,"x1":7,"y1":11}],"side_windows":[{"side":"east","offset":3}],',
        ' "roof":{"battlements":true,"trim":"oak_fence"},"notes":"short note"}',
        `Rules: crop is FRACTIONS 0..1 of the photo (you cannot see pixel sizes). Crop TIGHT to the building (<=5% margin, EXCLUDE watermarks, text, logos, ground shadows); I erase whatever backdrop remains. width ${FACADE_LIMITS.minWidth}-${cap} (bigger = more detail). wall_top = fraction down the CROP where roof starts (walls below, roof above).`,
        `materials maps EACH color family you see to a plain block name (no "minecraft:" prefix). Buckets and their defaults: ${bucketTable()}. Map the LARGEST wall area to the wall's main block (usually stone_bricks/bricks/planks; cobblestone only if the wall is clearly cobble). Map dark shading to a dark SOLID (cobblestone, stone_bricks, black_concrete) - NEVER map any bucket to glass or glass_pane. Omit buckets to keep defaults.`,
        'floor/wall/corners: optional overrides, else I auto-pick the dominant transcribed blocks. depth 5-10 (how far back the hut extends, imagined). door.offset = x in blocks from the LEFT at width scale, -1 for none; I cut a 2-wide, 3-tall doorway. front_windows = tight boxes around EACH visible front window/door-glass in block coords (x from left, y rows from TOP, width scale), max 6; I stamp them as glass. side_windows only east/west/north (front comes from the photo), offset along that side from its start, max 8.',
        'roof.material optional (else dominant transcribed roof block); battlements true adds a crenellated trim row on top; trim optional (else roof block). Prefer: stone_bricks, mossy_stone_bricks, cracked_stone_bricks, cobblestone, oak_log, spruce_log, *_planks, *_stairs, *_slab, *_fence, glass, glass_pane.',
    ].join('\n');
}

/**
 * Validate + clamp raw VLM JSON into the canonical facade plan. Never throws
 * for bad values: everything falls back to safe defaults.
 */
export function normalizeFacadeVision(rawVision, maxWidth = FACADE_LIMITS.maxWidth) {
    const src = (rawVision && typeof rawVision === 'object') ? rawVision : {};
    const cap = Math.max(FACADE_LIMITS.minWidth,
        Math.min(FACADE_LIMITS.maxWidth, Math.floor(maxWidth) || FACADE_LIMITS.maxWidth));
    let crop = null;
    if (src.crop && typeof src.crop === 'object') {
        const x = clampFrac(src.crop.x, 0, 0, 0.9);
        const y = clampFrac(src.crop.y, 0, 0, 0.9);
        const w = clampFrac(src.crop.w, 1 - x, 0.1, 1 - x);
        const h = clampFrac(src.crop.h, 1 - y, 0.1, 1 - y);
        crop = { x, y, w, h };
    }
    const width = clampInt(src.width, 24, FACADE_LIMITS.minWidth, cap);
    const wallTop = clampFrac(src.wall_top ?? src.wallTop, 0.45, 0.15, 0.9);
    const materials = {};
    if (src.materials && typeof src.materials === 'object') {
        for (const b of FACADE_BUCKETS) {
            if (src.materials[b.name] !== undefined) {
                let block = cleanFacadeBlock(src.materials[b.name], b.block);
                // No global glass: dark pixels are 95% shadow/mortar, so a
                // bucket-wide glass mapping sprays panes everywhere. Windows
                // come only from front_windows rects (stamped as glass later).
                if (block === 'glass' || block === 'glass_pane') block = b.block;
                materials[b.name] = block;
            }
        }
    }
    const floor = cleanFacadeBlock(src.floor, 'cobblestone');
    const wall = typeof src.wall === 'string' ? cleanFacadeBlock(src.wall, null) : null;
    const corners = typeof src.corners === 'string' ? cleanFacadeBlock(src.corners, null) : null;
    const depth = clampInt(src.depth, 7, FACADE_LIMITS.minDepth, FACADE_LIMITS.maxDepth);
    const doorOffset = clampInt(src.door?.offset, -1, -1, width - 1);
    const sideWindows = [];
    if (Array.isArray(src.side_windows ?? src.sideWindows)) {
        for (const w of (src.side_windows ?? src.sideWindows)) {
            if (sideWindows.length >= FACADE_LIMITS.maxWindows) break;
            const side = String(w?.side || '').toLowerCase();
            if (!FACADE_SIDES.includes(side)) continue;
            const len = side === 'north' ? width : depth;
            sideWindows.push({ side, offset: clampInt(w?.offset, Math.floor(len / 2), 1, Math.max(1, len - 2)) });
        }
    }
    const roofSrc = (src.roof && typeof src.roof === 'object') ? src.roof : {};
    const roof = {
        material: typeof roofSrc.material === 'string' ? cleanFacadeBlock(roofSrc.material, null) : null,
        battlements: roofSrc.battlements === true,
        trim: typeof roofSrc.trim === 'string' ? cleanFacadeBlock(roofSrc.trim, null) : null,
    };
    const notes = typeof src.notes === 'string' ? src.notes.slice(0, 280) : '';
    // Front window rects in block coords (x from left, y rows from TOP) at
    // width scale, matching the untrimmed transcription. Clamped to the real
    // grid later by adjustForTrim. Max 6.
    const frontWindows = [];
    if (Array.isArray(src.front_windows ?? src.frontWindows)) {
        for (const r of (src.front_windows ?? src.frontWindows)) {
            if (frontWindows.length >= 6) break;
            if (!r || typeof r !== 'object') continue;
            let x0 = clampInt(r.x0, -1, 0, FACADE_LIMITS.maxWidth - 1);
            let x1 = clampInt(r.x1, -1, 0, FACADE_LIMITS.maxWidth - 1);
            let y0 = clampInt(r.y0, -1, 0, FACADE_LIMITS.maxHeight - 1);
            let y1 = clampInt(r.y1, -1, 0, FACADE_LIMITS.maxHeight - 1);
            if (x0 < 0 || x1 < 0 || y0 < 0 || y1 < 0) continue;
            if (x1 < x0) [x0, x1] = [x1, x0];
            if (y1 < y0) [y0, y1] = [y1, y0];
            frontWindows.push({ x0, x1, y0, y1 });
        }
    }
    return { crop, width, wallTop, materials, floor, wall, corners, depth, doorOffset, sideWindows, frontWindows, roof, notes };
}

/**
 * Shift block-space coords from the untrimmed grid into the trimmed grid:
 * wall split (exact, from the original height), door x, and window rects
 * (rects falling fully outside are dropped).
 */
export function adjustForTrim(plan, trimTop, trimLeft, origH, gridW, gridH) {
    plan.wallTopRowAbs = Math.max(1, Math.min(gridH - 1, Math.round(plan.wallTop * origH) - trimTop));
    if (plan.doorOffset >= 0) {
        plan.doorOffset = Math.max(0, Math.min(gridW - 2, plan.doorOffset - trimLeft));
    }
    const kept = [];
    for (const r of plan.frontWindows) {
        const x0 = r.x0 - trimLeft, x1 = r.x1 - trimLeft;
        const y0 = r.y0 - trimTop, y1 = r.y1 - trimTop;
        if (x1 < 0 || y1 < 0 || x0 >= gridW || y0 >= gridH) continue;
        kept.push({
            x0: Math.max(0, x0), x1: Math.min(gridW - 1, x1),
            y0: Math.max(0, y0), y1: Math.min(gridH - 1, y1),
        });
    }
    plan.frontWindows = kept;
    return plan;
}

// Most frequent non-air block in the given rows, excluding glass (window glass
// must never become a wall or trim material).
function dominantBlock(blockGrid, r0, r1, fallback, exclude = null) {
    const counts = new Map();
    for (let r = r0; r <= r1; r++) {
        for (const b of blockGrid[r]) {
            if (!b || b === 'air') continue;
            counts.set(b, (counts.get(b) || 0) + 1);
        }
    }
    let best = fallback, bestN = 0;
    for (const [b, n] of counts.entries()) {
        if (b === 'glass' || b === 'glass_pane' || b === exclude) continue;
        if (n > bestN) { bestN = n; best = b; }
    }
    return best;
}

function rotatePlacement(placement) {
    const transposed = placement[0].map((_, x) => placement.map(row => row[x]));
    return transposed.map(row => row.reverse());
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

/**
 * Build the 3D shell: transcribed front + imagined sides/back/roof.
 * Facade row r (0 = top) lands on level H-1-r at z=0. Rows below wallTopRow
 * are the wall band (sides/back get walls); rows above are the roof band
 * (sides/back get stepped gables). Coordinates rise one Y per level.
 */
export function generateShell(blockGrid, plan, origin = { x: 0, y: 0, z: 0 }, orientation = 'south') {
    const H = blockGrid.length, W = blockGrid[0].length, D = plan.depth;
    const wallTopRow = Number.isInteger(plan.wallTopRowAbs)
        ? Math.max(1, Math.min(H - 1, plan.wallTopRowAbs))
        : Math.max(1, Math.min(H - 1, Math.round(plan.wallTop * H)));
    const wallTopLevel = H - 1 - wallTopRow; // highest level still in the wall band
    const wallBlock = plan.wall || dominantBlock(blockGrid, wallTopRow, H - 1, 'stone_bricks');
    const roofBlock = plan.roof.material || dominantBlock(blockGrid, 0, wallTopRow - 1, 'stone_bricks');
    // Trim auto-detection: the second wall-band material (timber frame, moss
    // course) propagates to corner posts so detail wraps the shell.
    const cornerBlock = plan.corners || dominantBlock(blockGrid, wallTopRow, H - 1, wallBlock, wallBlock);
    const trimBlock = plan.roof.trim || roofBlock;
    const ox = Math.floor(origin.x), oy = Math.floor(origin.y), oz = Math.floor(origin.z);
    const levels = [];
    const pushLevel = (level, placement) => {
        levels.push({ level, coordinates: [ox, oy + level, oz], placement });
    };
    const windowLevel = Math.min(2, Math.max(1, wallTopLevel));
    const winKey = new Set(plan.sideWindows.map(w => `${w.side}@${w.offset}:${windowLevel}`));

    for (let L = 0; L < H; L++) {
        const r = H - 1 - L; // facade row for this level
        const grid = emptyLevel(W, D);
        if (L === 0) {
            // Floor slab; front edge keeps the transcribed base (steps) or floor.
            for (let x = 0; x < W; x++) {
                grid[0][x] = (blockGrid[r][x] && blockGrid[r][x] !== 'air') ? blockGrid[r][x] : plan.floor;
                for (let z = 1; z < D; z++) grid[z][x] = plan.floor;
            }
            pushLevel(L, grid);
            continue;
        }
        // Front: exact transcription.
        for (let x = 0; x < W; x++) grid[0][x] = blockGrid[r][x];
        // Doorway cut (2 wide, L1..L3 or wall top).
        if (plan.doorOffset >= 0 && L >= 1 && L <= Math.min(3, wallTopLevel)) {
            const dx = Math.min(plan.doorOffset, W - 2);
            grid[0][dx] = 'air';
            grid[0][dx + 1] = 'air';
        }
        // Front window rects stamped as glass over the transcription.
        if (plan.frontWindows) {
            for (const rect of plan.frontWindows) {
                if (r < rect.y0 || r > rect.y1) continue;
                for (let x = Math.max(0, rect.x0); x <= Math.min(W - 1, rect.x1); x++) {
                    grid[0][x] = 'glass';
                }
            }
        }
        const inWallBand = L <= wallTopLevel;
        // Gable z-range for roof-band levels (ridge along X).
        const j = L - (wallTopLevel + 1);
        let z0 = 1, z1 = D - 1;
        if (!inWallBand) {
            if (2 * j < D) { z0 = j; z1 = D - 1 - j; }
            else { z0 = Math.floor((D - 1) / 2); z1 = Math.ceil((D - 1) / 2); } // ridge strip
        }
        for (let z = 1; z < D; z++) {
            for (let x = 0; x < W; x++) {
                const sideEdge = x === 0 || x === W - 1;
                const backEdge = z === D - 1;
                if (!sideEdge && !backEdge) continue; // hollow interior
                if (inWallBand) {
                    const isCorner = sideEdge && (z === 1 || backEdge);
                    let b = isCorner ? cornerBlock : wallBlock;
                    if (L === windowLevel) {
                        if (x === 0 && winKey.has(`west@${z}:${L}`)) b = 'glass';
                        if (x === W - 1 && winKey.has(`east@${z}:${L}`)) b = 'glass';
                        if (backEdge && !sideEdge && winKey.has(`north@${x}:${L}`)) b = 'glass';
                    }
                    grid[z][x] = b;
                } else if (z >= z0 && z <= z1) {
                    grid[z][x] = roofBlock;
                }
            }
        }
        pushLevel(L, grid);
    }
    if (plan.roof.battlements) {
        // Crenellated trim ring crowning the roof.
        const grid = emptyLevel(W, D);
        for (let z = 0; z < D; z++) {
            for (let x = 0; x < W; x++) {
                const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1;
                if (edge && (x + z) % 2 === 0) grid[z][x] = trimBlock;
            }
        }
        pushLevel(H, grid);
    }
    if (orientation === 'east') {
        for (const lvl of levels) lvl.placement = rotatePlacement(lvl.placement);
    }
    return {
        materials: countMaterials(levels),
        levels,
        meta: {
            kind: 'facade', width: orientation === 'east' ? D : W,
            depth: orientation === 'east' ? W : D, height: H,
            wallTopRow, wallBlock, roofBlock, orientation,
        },
    };
}

/**
 * ASCII preview of the transcribed facade (top row first, like pixel art).
 */
export function previewFacade(bucketGrid, legend) {
    const used = new Set();
    const rows = bucketGrid.map(row => row.map(idx => {
        if (idx === -1) return '.';
        const b = FACADE_BUCKETS[idx];
        used.add(b.name);
        return b.glyph;
    }).join(''));
    const leg = [...used].sort().map(n => `${FACADE_BUCKETS.find(b => b.name === n).glyph}=${n}->${legend[n]}`).join(' ');
    return rows.join('\n') + `\n-- legend (.=air): ${leg}`;
}

/**
 * ASCII preview of one shell level. Glyphs come from the legend so moss,
 * timber, and trim read distinctly from plain walls.
 */
export function previewShellLevel(blueprint, plan, levelNum) {
    const lvl = blueprint.levels[levelNum];
    if (!lvl) return `Level ${levelNum} out of range (0-${blueprint.levels.length - 1}).`;
    const blockGlyph = {};
    for (const b of FACADE_BUCKETS) {
        const block = plan.legend[b.name];
        if (block && !(block in blockGlyph)) blockGlyph[block] = b.glyph;
    }
    blockGlyph['glass'] = blockGlyph['glass'] || 'o';
    const used = new Set();
    const rows = lvl.placement.map(row => row.map(block => {
        if (!block || block === 'air') return '.';
        used.add(block);
        return blockGlyph[block] || '?';
    }).join(''));
    const w = lvl.placement[0].length, d = lvl.placement.length;
    const leg = [...used].sort().map(b => `${blockGlyph[b] || '?'}=${b}`).join(' ');
    return `L${lvl.level} at [${lvl.coordinates.join(', ')}] (${w}x${d}, +=x/east, rows=+z/south):\n`
        + rows.join('\n') + `\n-- legend (.=air): ${leg}`;
}

export function describeFacadePlan(plan, w, h, airFrac) {
    const wins = plan.sideWindows.length
        ? plan.sideWindows.map(x => `${x.side}@${x.offset}`).join(', ') : 'none';
    const mapped = Object.keys(plan.materials).length;
    const fw = (plan.frontWindows || []).length;
    return `${w}x${h} transcribed front (${Math.round(airFrac * 100)}% backdrop erased), depth ${plan.depth}, `
        + `walls->roof split ${Math.round(plan.wallTop * 100)}% down, ${mapped} material overrides. `
        + `Door: ${plan.doorOffset >= 0 ? `x=${plan.doorOffset} (2x3 air cut)` : 'none'}. `
        + `Front windows: ${fw} rects. Side windows: ${wins}. Roof: ${plan.roof.battlements ? 'battlements on' : 'plain stepped gable'}.`
        + (plan.notes ? ` Vision notes: ${plan.notes}` : '');
}

export { levelsSummary };

