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

// Curated free anatomy assets. URLs picked to be stable and reasonably small
// thumbnails so offline saves don't bloat the device. Sources: Wikimedia
// Commons (public domain or CC-BY-SA) and OpenStax Anatomy (CC-BY).
const SEED: Omit<LibraryItem, 'id' | 'local_path' | 'is_offline'>[] = [
  // Skeletal
  { title: 'Skeleton (anterior view)', system: 'Skeletal', license: 'CC-BY OpenStax', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Human_skeleton_front.svg/640px-Human_skeleton_front.svg.png' },
  { title: 'Skull lateral', system: 'Skeletal', license: 'PD Gray\'s', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Gray188.png/640px-Gray188.png' },
  { title: 'Vertebral column', system: 'Skeletal', license: 'PD', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Human_vertebral_column_color.png/512px-Human_vertebral_column_color.png' },

  // Muscular
  { title: 'Muscular system (anterior)', system: 'Muscular', license: 'PD', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Anterior_view_of_human_male_muscle_anatomy.jpg/640px-Anterior_view_of_human_male_muscle_anatomy.jpg' },
  { title: 'Muscles of the arm', system: 'Muscular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/1120_Muscles_that_Move_the_Humerus.jpg/640px-1120_Muscles_that_Move_the_Humerus.jpg' },

  // Nervous
  { title: 'Brain (lateral, labelled)', system: 'Nervous', license: 'PD', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Lateral_view_of_human_brain.png/640px-Lateral_view_of_human_brain.png' },
  { title: 'Neuron structure', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Blausen_0657_MultipolarNeuron.png/640px-Blausen_0657_MultipolarNeuron.png' },
  { title: 'Spinal cord cross-section', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/1318_Spinal_Cord_Cross_Section.jpg/640px-1318_Spinal_Cord_Cross_Section.jpg' },

  // Cardiovascular
  { title: 'Heart anatomy (chambers)', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/2002_The_Heart.jpg/640px-2002_The_Heart.jpg' },
  { title: 'Coronary arteries', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/2017_Coronary_Arteries.jpg/640px-2017_Coronary_Arteries.jpg' },
  { title: 'Systemic circulation', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/2102_Cardiovascular_Circulation.jpg/640px-2102_Cardiovascular_Circulation.jpg' },

  // Respiratory
  { title: 'Respiratory tract', system: 'Respiratory', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/2301_Major_Respiratory_Organs.jpg/640px-2301_Major_Respiratory_Organs.jpg' },
  { title: 'Lung lobes', system: 'Respiratory', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/2308_The_Lung_Lobes.jpg/640px-2308_The_Lung_Lobes.jpg' },

  // Digestive
  { title: 'Digestive system overview', system: 'Digestive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/2401_Components_of_the_Digestive_System.jpg/640px-2401_Components_of_the_Digestive_System.jpg' },
  { title: 'Stomach (cut section)', system: 'Digestive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/2416_StomachN.jpg/640px-2416_StomachN.jpg' },
  { title: 'Liver anatomy', system: 'Digestive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/2422_Accessory_Organs.jpg/640px-2422_Accessory_Organs.jpg' },

  // Urinary
  { title: 'Urinary system', system: 'Urinary', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/2601_The_Urinary_System.jpg/640px-2601_The_Urinary_System.jpg' },
  { title: 'Nephron', system: 'Urinary', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/2610_The_Nephron.jpg/640px-2610_The_Nephron.jpg' },

  // Endocrine
  { title: 'Endocrine glands', system: 'Endocrine', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/1801_The_Endocrine_System.jpg/640px-1801_The_Endocrine_System.jpg' },

  // Reproductive
  { title: 'Female reproductive', system: 'Reproductive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/2901_Female_Reproductive_System.jpg/640px-2901_Female_Reproductive_System.jpg' },
  { title: 'Male reproductive', system: 'Reproductive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/2801_The_Major_Male_Reproductive_Organs.jpg/640px-2801_The_Major_Male_Reproductive_Organs.jpg' },

  // Multi-angle views — feels like 3D, fully offlineable.
  // Skull (multiple angles)
  { title: 'Skull anterior', system: 'Skeletal', license: 'PD', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Sobo_1909_43.png/512px-Sobo_1909_43.png' },
  { title: 'Skull posterior', system: 'Skeletal', license: 'PD', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Gray194.png/512px-Gray194.png' },
  { title: 'Skull base (inferior)', system: 'Skeletal', license: 'PD', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Gray188.png/512px-Gray188.png' },

  // Heart (multiple angles)
  { title: 'Heart anterior view', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/2011_Heart_Anatomy.jpg/640px-2011_Heart_Anatomy.jpg' },
  { title: 'Heart posterior view', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/2014_Posterior_View_of_Heart.jpg/640px-2014_Posterior_View_of_Heart.jpg' },
  { title: 'Heart conduction system', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/2018_Conduction_System_of_Heart.jpg/640px-2018_Conduction_System_of_Heart.jpg' },
  { title: 'Cardiac cycle', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/2027_Phases_of_the_Cardiac_Cycle.jpg/640px-2027_Phases_of_the_Cardiac_Cycle.jpg' },

  // Brain (multiple angles)
  { title: 'Brain superior view', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/1605_Brain_in_Skull.jpg/640px-1605_Brain_in_Skull.jpg' },
  { title: 'Brain mid-sagittal', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/1310_Diencephalon.jpg/640px-1310_Diencephalon.jpg' },
  { title: 'Brain limbic system', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/1511_The_Limbic_Lobe.jpg/640px-1511_The_Limbic_Lobe.jpg' },
  { title: 'Brain lobes labelled', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/1605_Brain_in_Skull.jpg/640px-1605_Brain_in_Skull.jpg' },
  { title: 'Cranial nerves origin', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/1320_Cranial_Nerves_Labeled.jpg/640px-1320_Cranial_Nerves_Labeled.jpg' },

  // Eye
  { title: 'Eye anatomy (sagittal)', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/1413_Structure_of_the_Eye.jpg/640px-1413_Structure_of_the_Eye.jpg' },
  { title: 'Retina layers', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/1416_Layers_of_the_Retina.jpg/640px-1416_Layers_of_the_Retina.jpg' },

  // Ear
  { title: 'Ear anatomy (outer/middle/inner)', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/1404_The_Structures_of_the_Ear.jpg/640px-1404_The_Structures_of_the_Ear.jpg' },
  { title: 'Cochlea cross-section', system: 'Nervous', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/1408_The_Cochlea.jpg/640px-1408_The_Cochlea.jpg' },

  // Kidney
  { title: 'Kidney cut-section', system: 'Urinary', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/2608_Kidney_with_Capsule_Removed.jpg/640px-2608_Kidney_with_Capsule_Removed.jpg' },
  { title: 'Nephron blood supply', system: 'Urinary', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/2613_Blood_Flow_in_the_Nephron.jpg/640px-2613_Blood_Flow_in_the_Nephron.jpg' },

  // Liver / GI
  { title: 'Liver anterior + posterior', system: 'Digestive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/2422_Accessory_Organs.jpg/640px-2422_Accessory_Organs.jpg' },
  { title: 'Small intestine wall layers', system: 'Digestive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/2420_Small_Intestine.jpg/640px-2420_Small_Intestine.jpg' },
  { title: 'Pancreas + bile ducts', system: 'Digestive', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/2426_Pancreas.jpg/640px-2426_Pancreas.jpg' },

  // Lung
  { title: 'Bronchial tree', system: 'Respiratory', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/2306_Bronchial_Tree.jpg/640px-2306_Bronchial_Tree.jpg' },
  { title: 'Alveoli + gas exchange', system: 'Respiratory', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/2310_Alveoli_and_Capillary.jpg/640px-2310_Alveoli_and_Capillary.jpg' },

  // Vessels
  { title: 'Arteries of the body', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/2120_Major_Systemic_Artery.jpg/640px-2120_Major_Systemic_Artery.jpg' },
  { title: 'Veins of the body', system: 'Cardiovascular', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/2121_Major_Systemic_Veins.jpg/640px-2121_Major_Systemic_Veins.jpg' },

  // Endocrine
  { title: 'Pituitary + hypothalamus', system: 'Endocrine', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/1806_The_Hypothalamus-Pituitary_Complex.jpg/640px-1806_The_Hypothalamus-Pituitary_Complex.jpg' },
  { title: 'Thyroid + parathyroid', system: 'Endocrine', license: 'CC-BY', kind: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/1813_The_Thyroid_Gland.jpg/640px-1813_The_Thyroid_Gland.jpg' },

  // Online 3D portals (still useful when device is online)
  { title: 'BioDigital Human 3D (online)', system: '3D Interactive', license: 'BioDigital free tier', kind: 'web',
    url: 'https://human.biodigital.com/explore' },
  { title: 'Sketchfab — anatomy collection', system: '3D Interactive', license: 'Mixed CC', kind: 'web',
    url: 'https://sketchfab.com/search?q=anatomy&type=models' },
  { title: 'Z-Anatomy (open source models)', system: '3D Interactive', license: 'CC-BY-SA', kind: 'web',
    url: 'https://www.z-anatomy.com/' },
  { title: 'Anatomography (BodyParts3D)', system: '3D Interactive', license: 'CC-BY-SA', kind: 'web',
    url: 'https://lifesciencedb.jp/bp3d/?lng=en' },
  { title: 'NIH 3D — anatomy print exchange', system: '3D Interactive', license: 'CC0 / public', kind: 'web',
    url: 'https://3d.nih.gov/' },

  // True in-app 3D demo (Khronos sample — open CC). User can add real anatomy
  // GLBs via the "+" button with any direct .glb URL.
  { title: 'Demo: Damaged Helmet (3D)', system: '3D Models', license: 'CC-BY-NC (demo)', kind: '3d',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb' },
  { title: 'Demo: Avocado (3D)', system: '3D Models', license: 'CC0 (demo)', kind: '3d',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Avocado/glTF-Binary/Avocado.glb' },
];

const ANATOMY_DIR = (FileSystem.documentDirectory || '') + 'anatomy/';

export const ensureSeeded = (): void => {
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
