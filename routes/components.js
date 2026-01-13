import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Base directory is one level up from routes
const BASE_DIR = path.resolve(__dirname, '..');

let companionManifestCache = null;

function formatComponentLabel(id) {
    return id
        .split('/')
        .map(segment => segment
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, char => char.toUpperCase()))
        .join(' ');
}

async function collectJsModulesRecursive(baseDir, options = {}) {
    const {
        relativeTo = baseDir,
        recursive = true,
        filter = () => true,
        labelFormatter
    } = options;

    const results = [];
    try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const entryPath = path.join(baseDir, entry.name);
            if (entry.isDirectory()) {
                if (recursive) {
                    const subResults = await collectJsModulesRecursive(entryPath, options);
                    results.push(...subResults);
                }
                continue;
            }

            if (!entry.name.endsWith('.js')) continue;
            const relativePath = path.relative(relativeTo, entryPath).replace(/\\/g, '/');
            if (!filter(relativePath)) continue;

            const id = relativePath.replace(/\.js$/, '');
            const label = labelFormatter ? labelFormatter(id) : formatComponentLabel(id);
            results.push({ id, label });
        }
    } catch (error) {
        console.error(`[Components] Failed to read modules from ${baseDir}:`, error.message);
    }
    return results;
}

async function buildComponentManifest({ refresh = false } = {}) {
    if (refresh) {
        companionManifestCache = null;
    }
    if (companionManifestCache) {
        return companionManifestCache;
    }

    const companionsDir = path.join(BASE_DIR, 'companions');
    const promptsDir = path.join(BASE_DIR, 'prompts');

    const [companionHandlers, companionAgents, companionPrompts] = await Promise.all([
        collectJsModulesRecursive(path.join(companionsDir, 'handlers'), {
            relativeTo: path.join(companionsDir, 'handlers'),
            filter: (relativePath) => !relativePath.endsWith('index.js')
        }),
        collectJsModulesRecursive(path.join(companionsDir, 'agents'), {
            relativeTo: path.join(companionsDir, 'agents'),
            filter: (relativePath) => !relativePath.endsWith('index.js')
        }),
        (async () => {
            try {
                const entries = await fs.readdir(promptsDir, { withFileTypes: true });
                return entries
                    .filter(entry => entry.isFile() && entry.name.startsWith('companion_') && entry.name.endsWith('.js'))
                    .map(entry => {
                        const id = entry.name.replace(/\.js$/, '');
                        const label = id
                            .replace(/^companion[_-]?/i, '')
                            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                            .replace(/[_-]/g, ' ')
                            .trim()
                            .replace(/\b\w/g, char => char.toUpperCase());
                        return { id, label };
                    });
            } catch (error) {
                console.error('[Components] Failed to read companion prompts:', error.message);
                return [];
            }
        })(),
    ]);

    const dedupe = (items = []) => {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
    };

    const manifest = {
        companion: {
            coordinator: { id: 'companions/CompanionCoordinator', label: 'Companion Coordinator' },
            handlers: dedupe(companionHandlers),
            agents: dedupe(companionAgents),
            prompts: companionPrompts
        },
        orchestrator: {
            id: 'orchestrator',
            label: 'Orchestrator'
        }
    };

    companionManifestCache = manifest;
    return manifest;
}

router.get('/companion-components', async (req, res) => {
    try {
        const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
        const manifest = await buildComponentManifest({ refresh });
        res.json(manifest);
    } catch (error) {
        console.error('[Components] Error building companion manifest:', error.message);
        res.status(500).json({ error: 'Failed to load companion components' });
    }
});

export default router;
