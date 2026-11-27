/**
 * Agent-level orchestration for facade-capture building: the VLM directs
 * (crop, materials, imagined depth/sides/roof) while code transcribes the
 * photo front pixel-by-pixel. Both !analyzeHouseImage (queries) and
 * !buildHouse (actions) share this path so the plan step behaves identically
 * whether inspecting or building.
 */
import fs from 'fs';
import { Buffer } from 'buffer';
import * as house from './housefromimage.js';
import * as facade from './facade.js';
import * as skills from './skills.js';

const MAX_IMAGE_SIDE = 1024;

/**
 * Load a repo-relative path or http(s) URL into a JPEG buffer for the vision
 * model (providers here expect JPEG bytes). Falls back to raw bytes when the
 * canvas package is unavailable.
 */
export async function loadHouseImageBuffer(imagePath) {
    const src = String(imagePath || '');
    let input = src;
    if (/^https?:\/\//i.test(src)) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
        input = Buffer.from(await res.arrayBuffer());
    } else if (!fs.existsSync(src)) {
        throw new Error(`File not found "${src}". Paths resolve from the repo root; URLs must start with http(s).`);
    }
    let canvasLib;
    try {
        canvasLib = await import('canvas');
    } catch (e) {
        if (Buffer.isBuffer(input)) return input;
        return fs.readFileSync(src);
    }
    const img = await canvasLib.loadImage(input);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = canvasLib.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toBuffer('image/jpeg');
}

/**
 * Transcribe the photo front deterministically: crop -> resize -> color
 * buckets -> backdrop flood-fill. Returns the bucket grid plus its size.
 */
export async function quantizeFacadeImage(imagePath, crop, width) {
    let canvasLib;
    try {
        canvasLib = await import('canvas');
    } catch (e) {
        throw new Error('facade transcription needs the "canvas" package (npm install canvas).');
    }
    const src = String(imagePath || '');
    let input = src;
    if (/^https?:\/\//i.test(src)) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
        input = Buffer.from(await res.arrayBuffer());
    }
    const img = await canvasLib.loadImage(input);
    const c = crop || { x: 0, y: 0, w: 1, h: 1 };
    const sx = Math.floor(c.x * img.width), sy = Math.floor(c.y * img.height);
    const sw = Math.max(1, Math.floor(c.w * img.width)), sh = Math.max(1, Math.floor(c.h * img.height));
    let w = Math.max(facade.FACADE_LIMITS.minWidth,
        Math.min(facade.FACADE_LIMITS.maxWidth, Math.floor(width) || 24));
    let h = Math.max(1, Math.round(w * sh / sw));
    if (h > facade.FACADE_LIMITS.maxHeight) {
        h = facade.FACADE_LIMITS.maxHeight;
        w = Math.max(facade.FACADE_LIMITS.minWidth, Math.round(h * sw / sh));
    }
    const canvas = canvasLib.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const buckets = facade.quantizePixelsToBuckets(pixels, w, h);
    const { grid: filled } = facade.floodFillBackground(buckets);
    const { grid: trimmed, top: trimTop, left: trimLeft } = facade.trimAirBorders(filled);
    const clean = facade.despeckle(trimmed);
    const origTotal = w * h;
    let solid = 0;
    for (const row of clean) for (const c of row) if (c !== -1) solid++;
    return {
        bucketGrid: clean, width: clean[0].length, height: clean.length,
        airFrac: 1 - solid / origTotal, trimTop, trimLeft, origH: h,
    };
}

/**
 * Full plan step: photo -> VLM direction -> exact front transcription ->
 * imagined shell blueprint.
 * @param {Object} agent, the agent (needs prompter.vision_model + history).
 * @param {string} imagePath, repo-relative path or http(s) URL of the photo.
 * @param {number} width, facade width in blocks (12-32, bigger = more detail).
 * @returns {Promise<string>} chat-ready summary with facade preview + levels.
 */
export async function analyzeHouseImage(agent, imagePath, width = 24) {
    const bot = agent.bot;
    if (!agent.prompter?.vision_model?.sendVisionRequest) {
        const msg = 'This profile has no vision model (vision_model.sendVisionRequest is missing). Switch to a vision-capable profile to use house-from-image.';
        skills.log(bot, msg);
        return msg;
    }
    let buffer;
    try {
        buffer = await loadHouseImageBuffer(imagePath);
    } catch (e) {
        const msg = `Could not load image "${imagePath}": ${e.message}`;
        skills.log(bot, msg);
        return msg;
    }
    const prompt = facade.buildFacadePrompt(width);
    let raw;
    try {
        await agent.prompter.checkCooldown();
        const messages = agent.history.getHistory();
        raw = await agent.prompter.vision_model.sendVisionRequest(messages, prompt, buffer);
    } catch (e) {
        const msg = `Vision request failed: ${e.message}`;
        skills.log(bot, msg);
        return msg;
    }
    bot._houseVisionRaw = String(raw || '').slice(0, 2000);
    let plan;
    try {
        const parsed = house.parseHousePlan(raw);
        plan = facade.normalizeFacadeVision(parsed.plan, width);
    } catch (e) {
        const snippet = String(raw || '').slice(0, 400);
        const msg = `The vision model did not return a plan (${e.message}). Raw reply: "${snippet}". Try !analyzeHouseImage again or with a clearer photo.`;
        skills.log(bot, msg);
        return msg;
    }
    let transcribed;
    try {
        transcribed = await quantizeFacadeImage(imagePath, plan.crop, plan.width);
    } catch (e) {
        const msg = `Front transcription failed: ${e.message}`;
        skills.log(bot, msg);
        return msg;
    }
    facade.adjustForTrim(plan, transcribed.trimTop, transcribed.trimLeft,
        transcribed.origH, transcribed.width, transcribed.height);
    const { blockGrid, legend } = facade.mapGridToBlocks(transcribed.bucketGrid, plan.materials);
    plan.legend = legend;
    plan.facadeWidth = transcribed.width;
    plan.facadeHeight = transcribed.height;
    plan.airFrac = transcribed.airFrac;
    skills.applyFacadePlan(bot, plan, blockGrid, transcribed.bucketGrid);
    skills.generateFacadeBlueprint(bot);
    const bp = bot._houseBlueprint;
    const total = Object.values(bp.materials).reduce((a, b) => a + b, 0);
    const summary = `Facade plan from ${imagePath}: ${facade.describeFacadePlan(plan, transcribed.width, transcribed.height, transcribed.airFrac)}\n`
        + `Shell blueprint: ${bp.levels.length} levels, ${total} blocks. Materials: ${JSON.stringify(bp.materials)}\n`
        + `${facade.levelsSummary(bp)}\n`
        + `Front transcription (top row first):\n${facade.previewFacade(transcribed.bucketGrid, legend)}\n`
        + `Next: inspect one level with !getHouseLevel(N), then build bottom-up with !buildHouseLevel(N) (L0 first).`;
    skills.log(bot, summary);
    return summary;
}
