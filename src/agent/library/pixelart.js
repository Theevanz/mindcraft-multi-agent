/**
 * Pixel-art support library: fixed 4-bit palette + vertical (build-up) blueprint generator.
 *
 * Design notes (do not change lightly):
 * - The palette is FIXED at 16 entries (4-bit). Same input color always maps to the
 *   same block, so all black uses the same black, all white the same white, etc.
 * - Blueprints build UP, not flat: an image W px wide x H px tall becomes H levels,
 *   each level holding exactly one image row (W blocks). A 100x100 mural is therefore
 *   100 levels of ~100 blocks, and the agent handles one level per context window via
 *   !getBlueprintLevel / !checkBlueprintLevel (or skills.buildPixelArtLevel).
 * - Pure logic only (no bot dependency) so the CLI harness and unit probes can import it.
 */
export const PALETTE_4BIT = [
    { index: 0, name: 'white', block: 'white_concrete', rgb: [233, 236, 236] },
    { index: 1, name: 'light_gray', block: 'light_gray_concrete', rgb: [157, 157, 151] },
    { index: 2, name: 'gray', block: 'gray_concrete', rgb: [99, 95, 98] },
    { index: 3, name: 'black', block: 'black_concrete', rgb: [29, 29, 33] },
    { index: 4, name: 'brown', block: 'brown_concrete', rgb: [96, 59, 31] },
    { index: 5, name: 'red', block: 'red_concrete', rgb: [149, 34, 33] },
    { index: 6, name: 'orange', block: 'orange_concrete', rgb: [224, 97, 0] },
    { index: 7, name: 'yellow', block: 'yellow_concrete', rgb: [240, 175, 21] },
    { index: 8, name: 'lime', block: 'lime_concrete', rgb: [112, 185, 26] },
    { index: 9, name: 'green', block: 'green_concrete', rgb: [84, 109, 27] },
    { index: 10, name: 'cyan', block: 'cyan_concrete', rgb: [21, 119, 136] },
    { index: 11, name: 'light_blue', block: 'light_blue_concrete', rgb: [58, 175, 217] },
    { index: 12, name: 'blue', block: 'blue_concrete', rgb: [53, 57, 157] },
    { index: 13, name: 'purple', block: 'purple_concrete', rgb: [122, 47, 188] },
    { index: 14, name: 'magenta', block: 'magenta_concrete', rgb: [189, 68, 179] },
    { index: 15, name: 'pink', block: 'pink_concrete', rgb: [238, 157, 195] },
];

export const PALETTE_NAME = 'concrete16';

function colorDistanceSq(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

export function nearestPaletteIndex(r, g, b, palette = PALETTE_4BIT) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const d = colorDistanceSq([r, g, b], palette[i].rgb);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/**
 * Quantize raw RGBA pixels (already resized to target W/H) to palette indices.
 * Transparent pixels (alpha < 128) become -1, meaning 'air'.
 */
export function quantizePixels(pixels, width, height, palette = PALETTE_4BIT) {
    const grid = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            const alpha = pixels[o + 3];
            if (alpha < 128) { row.push(-1); continue; }
            row.push(nearestPaletteIndex(pixels[o], pixels[o + 1], pixels[o + 2], palette));
        }
        grid.push(row);
    }
    return grid;
}

export function gridToBlockGrid(indexGrid, palette = PALETTE_4BIT) {
    return indexGrid.map(row => row.map(idx => (idx === -1 ? 'air' : palette[idx].block)));
}

export function countMaterials(blockGrid) {
    const counts = {};
    for (const row of blockGrid) {
        for (const block of row) {
            if (block === 'air') continue;
            counts[block] = (counts[block] || 0) + 1;
        }
    }
    return counts;
}

/**
 * Build a ConstructionTask-compatible blueprint from a block grid.
 * Vertical slicing: image row y (0 = top) maps to level (H-1-y), so level 0
 * is the BOTTOM row at origin.y and the wall grows upward one row per level.
 * - orientation 'south': wall spans X at fixed Z. Each level placement = [[w blocks]].
 * - orientation 'east': wall spans Z at fixed X. Each level placement = [[b],[b],...].
 */
export function generateBlueprint(blockGrid, origin = { x: 0, y: 0, z: 0 }, orientation = 'south') {
    const height = blockGrid.length;
    const width = height > 0 ? blockGrid[0].length : 0;
    const ox = Math.floor(origin.x), oy = Math.floor(origin.y), oz = Math.floor(origin.z);
    const levels = [];
    for (let level = 0; level < height; level++) {
        const imageRow = blockGrid[height - 1 - level]; // bottom row first
        let placement;
        if (orientation === 'east') {
            placement = imageRow.map(block => [block]);
        } else {
            placement = [ [...imageRow] ];
        }
        levels.push({ level, coordinates: [ox, oy + level, oz], placement });
    }
    return { materials: countMaterials(blockGrid), levels, meta: { width, height, orientation, palette: PALETTE_NAME } };
}

const PREVIEW_GLYPHS = ['W', 'l', 'g', 'K', 'N', 'R', 'O', 'Y', 'L', 'G', 'C', 'S', 'B', 'P', 'M', 'p'];

export function previewText(indexGrid, palette = PALETTE_4BIT) {
    const lines = indexGrid.map(row => row.map(idx => (idx === -1 ? '.' : (PREVIEW_GLYPHS[idx] || '?'))).join(''));
    const legend = palette.map((p, i) => `${PREVIEW_GLYPHS[i]}=${p.block}`).join(' ');
    return lines.join('\n') + '\n-- legend: ' + legend;
}

export function describePalette(palette = PALETTE_4BIT) {
    return palette.map(p => `${p.index}: ${p.name} -> ${p.block} rgb(${p.rgb.join(',')})`).join('\n');
}
