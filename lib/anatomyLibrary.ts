// Curated anatomy reference library (free / Creative-Commons images).
// Seeded into SQLite on first use. The user can tap "Save offline" on any
// row to download the file to documents/ and read it without internet.

import * as FileSystem from 'expo-file-system/legacy';
import { db, generateUUID, queueSyncOperation } from './db';

export type LibraryItem = {
  id: string;
  title: string;
  system: string;
  url: string;
  kind: 'image' | 'web' | '3d';
  license: string;
  local_path: string | null;
  is_offline: number;
};

// Curated free anatomy assets. All URLs use Wikimedia's canonical
// Special:FilePath endpoint which auto-redirects to the actual upload server.
// Every entry here has been HEAD-checked and verified to return 200.
const wm = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`;

const SEED: Omit<LibraryItem, 'id' | 'local_path' | 'is_offline'>[] = [
  // SKELETAL
  { title: 'Skeletal system (full body)', system: 'Skeletal', license: 'PD',       kind: 'image', url: wm('Skeletal system.svg') },
  { title: 'Skeleton anterior view',      system: 'Skeletal', license: 'CC-BY-SA', kind: 'image', url: wm('Human skeleton front.svg') },
  { title: 'Skeleton posterior view',     system: 'Skeletal', license: 'CC-BY-SA', kind: 'image', url: wm('Human skeleton back en.svg') },
  { title: 'Skull lateral (bones)',       system: 'Skeletal', license: 'CC-BY-SA', kind: 'image', url: wm('Human skull side bones.svg') },
  { title: 'Skull (Gray\'s anatomy)',      system: 'Skeletal', license: 'PD',       kind: 'image', url: wm('Gray188.png') },
  { title: 'Skull posterior (Gray\'s)',    system: 'Skeletal', license: 'PD',       kind: 'image', url: wm('Gray194.png') },

  // CARDIOVASCULAR
  { title: 'Heart anatomy (labelled)',    system: 'Cardiovascular', license: 'PD',       kind: 'image', url: wm('Heart numlabels.svg') },
  { title: 'Heart cross-section',         system: 'Cardiovascular', license: 'CC-BY-SA', kind: 'image', url: wm('Diagram of the human heart (cropped).svg') },
  { title: 'Heart (anterior + interior)', system: 'Cardiovascular', license: 'CC-BY',    kind: 'image', url: wm('The Heart.jpg') },
  { title: 'Cardiac conduction system',   system: 'Cardiovascular', license: 'CC-BY',    kind: 'image', url: wm('Cardiac Conduction System.jpg') },

  // NERVOUS
  { title: 'Brain inferior view (labelled)', system: 'Nervous', license: 'CC-BY-SA', kind: 'image', url: wm('Brain human normal inferior view with labels en.svg') },
  { title: 'Brain mid-sagittal',          system: 'Nervous', license: 'CC-BY-SA', kind: 'image', url: wm('Brain human sagittal section.svg') },
  { title: 'Brain CT scan',               system: 'Nervous', license: 'CC-BY-SA', kind: 'image', url: wm('Computed tomography of human brain - large.png') },
  { title: 'Neuron structure',            system: 'Nervous', license: 'CC-BY-SA', kind: 'image', url: wm('Neuron Structure.png') },
  { title: 'Multipolar neuron (Blausen)', system: 'Nervous', license: 'CC-BY',    kind: 'image', url: wm('Blausen 0657 MultipolarNeuron.png') },
  { title: 'Spinal cord cross-section',   system: 'Nervous', license: 'CC-BY-SA', kind: 'image', url: wm('Diagram of the Spinal Cord Unlabeled.jpg') },
  { title: 'Eye anatomy (diagram)',       system: 'Nervous', license: 'PD',       kind: 'image', url: wm('Eye-diagram no circles border.svg') },
  { title: 'Ear anatomy',                 system: 'Nervous', license: 'CC-BY-SA', kind: 'image', url: wm('Anatomy of the Human Ear.svg') },

  // URINARY
  { title: 'Kidney nephron',              system: 'Urinary', license: 'CC-BY-SA', kind: 'image', url: wm('Kidney nephron.png') },

  // RESPIRATORY
  { title: 'Respiratory system',          system: 'Respiratory', license: 'CC-BY-SA', kind: 'image', url: wm('Respiratory system complete en.svg') },
  { title: 'Pulmonary alveolus (NIH)',    system: 'Respiratory', license: 'PD',       kind: 'image', url: wm('Pulmonary Alveolus (NIH BioArt 567).svg') },
  { title: 'Larynx (external)',           system: 'Respiratory', license: 'CC-BY-SA', kind: 'image', url: wm('Larynx external en.svg') },

  // DIGESTIVE
  { title: 'Digestive system',            system: 'Digestive', license: 'CC-BY-SA', kind: 'image', url: wm('Digestive system diagram en.svg') },
  { title: 'Stomach diagram',             system: 'Digestive', license: 'CC-BY-SA', kind: 'image', url: wm('Stomach diagram.svg') },
  { title: 'Stomach mucosa layers',       system: 'Digestive', license: 'CC-BY-SA', kind: 'image', url: wm('Stomach mucosal layer labeled.svg') },
  { title: 'Pancreas',                    system: 'Digestive', license: 'CC-BY',    kind: 'image', url: wm('Pancreas.jpg') },
  { title: 'Small intestine',             system: 'Digestive', license: 'CC-BY',    kind: 'image', url: wm('Small Intestine.jpg') },

  // ENDOCRINE
  { title: 'Endocrine glands',            system: 'Endocrine', license: 'CC-BY-SA', kind: 'image', url: wm('Endocrine English.svg') },

  // REPRODUCTIVE
  { title: 'Female reproductive (lateral)', system: 'Reproductive', license: 'CC-BY-SA', kind: 'image', url: wm('Female reproductive system lateral unlabeled.svg') },
  { title: 'Female genital system (sagittal)', system: 'Reproductive', license: 'CC-BY-SA', kind: 'image', url: wm('Female genital system - Sagittal view.svg') },
  { title: 'Male genital system (front)', system: 'Reproductive', license: 'CC-BY-SA', kind: 'image', url: wm('Male genital system - Front view-1 for quizzing.svg') },

  // INTEGUMENTARY / REFERENCE
  { title: 'Skin layers cross-section',   system: 'Integumentary', license: 'CC-BY-SA', kind: 'image', url: wm('Skin layers.png') },
  { title: 'Anatomical planes',           system: 'Reference',     license: 'CC-BY-SA', kind: 'image', url: wm('Human anatomy planes.svg') },

  // Online 3D portals (always need internet)
  { title: 'BioDigital Human 3D',         system: '3D Interactive', license: 'BioDigital free tier', kind: 'web', url: 'https://human.biodigital.com/explore' },
  { title: 'Sketchfab anatomy library',   system: '3D Interactive', license: 'Mixed CC', kind: 'web', url: 'https://sketchfab.com/search?q=anatomy&type=models' },
  { title: 'Z-Anatomy (open atlas)',      system: '3D Interactive', license: 'CC-BY-SA', kind: 'web', url: 'https://www.z-anatomy.com/' },
  { title: 'Anatomography (BodyParts3D)', system: '3D Interactive', license: 'CC-BY-SA', kind: 'web', url: 'https://lifesciencedb.jp/bp3d/?lng=en' },
  { title: 'NIH 3D model library',        system: '3D Interactive', license: 'CC0 / public', kind: 'web', url: 'https://3d.nih.gov/' },
];

const ANATOMY_DIR = (FileSystem.documentDirectory || '') + 'anatomy/';

export const ensureSeeded = (): void => {
  // One-time cleanup: earlier seed shipped broken thumb-hash URLs. Wipe them
  // so the verified Special:FilePath URLs below take over without duplicates.
  try {
    db.runSync(
      `DELETE FROM anatomy_library WHERE url LIKE 'https://upload.wikimedia.org/wikipedia/commons/thumb/%' AND (is_offline IS NULL OR is_offline = 0)`
    );
  } catch {}
  // Idempotent — insert any seed entry that isn't already present (matched by
  // exact title + url). Lets us ship new catalog items without wiping.
  for (const s of SEED) {
    const existing = db.getFirstSync(
      `SELECT id FROM anatomy_library WHERE title = ? AND url = ? LIMIT 1`,
      [s.title, s.url]
    );
    if (existing) continue;
    const id = generateUUID();
    db.runSync(
      `INSERT INTO anatomy_library (id, title, system, url, kind, license) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, s.title, s.system, s.url, s.kind, s.license]
    );
    queueSyncOperation('anatomy_library', id, 'INSERT', { id, title: s.title, system: s.system, url: s.url, kind: s.kind, license: s.license, is_offline: 0, local_path: null });
  }
};

export const listLibrary = (system?: string): LibraryItem[] => {
  const rows = (system
    ? db.getAllSync(`SELECT * FROM anatomy_library WHERE system = ? ORDER BY title ASC`, [system])
    : db.getAllSync(`SELECT * FROM anatomy_library ORDER BY system ASC, title ASC`)
  ) as LibraryItem[];
  return rows || [];
};

export const listSystems = (): string[] => {
  const rows = db.getAllSync(`SELECT DISTINCT system FROM anatomy_library ORDER BY system ASC`) as any[];
  return (rows || []).map(r => r.system).filter(Boolean);
};

export const saveOffline = async (item: LibraryItem): Promise<LibraryItem> => {
  if (item.kind === 'web') return item; // web portals can't be offlined
  try {
    await FileSystem.makeDirectoryAsync(ANATOMY_DIR, { intermediates: true });
  } catch {}
  const defaultExt = item.kind === '3d' ? 'glb' : 'jpg';
  const ext = (item.url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1] || defaultExt).toLowerCase();
  const target = ANATOMY_DIR + item.id + '.' + ext;
  try {
    const dl = await FileSystem.downloadAsync(item.url, target);
    if (dl?.uri) {
      db.runSync(
        `UPDATE anatomy_library SET local_path = ?, is_offline = 1 WHERE id = ?`,
        [dl.uri, item.id]
      );
      queueSyncOperation('anatomy_library', item.id, 'UPDATE', { local_path: dl.uri, is_offline: 1 });
      return { ...item, local_path: dl.uri, is_offline: 1 };
    }
  } catch {}
  return item;
};

// Cache the <model-viewer> JS bundle locally so 3D models work fully offline.
export const ensureModelViewerCached = async (): Promise<string> => {
  try { await FileSystem.makeDirectoryAsync(ANATOMY_DIR, { intermediates: true }); } catch {}
  const target = ANATOMY_DIR + 'model-viewer.min.js';
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    try {
      await FileSystem.downloadAsync(
        'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js',
        target
      );
    } catch (e) {
      // If the download failed (offline first launch) just return the URL —
      // the WebView will fetch it online and work for this session.
      return 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
    }
  }
  return target;
};

export const removeOffline = async (item: LibraryItem): Promise<LibraryItem> => {
  if (item.local_path) {
    try { await FileSystem.deleteAsync(item.local_path, { idempotent: true }); } catch {}
  }
  db.runSync(`UPDATE anatomy_library SET local_path = NULL, is_offline = 0 WHERE id = ?`, [item.id]);
  queueSyncOperation('anatomy_library', item.id, 'UPDATE', { local_path: null, is_offline: 0 });
  return { ...item, local_path: null, is_offline: 0 };
};
