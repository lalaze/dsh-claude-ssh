import { currentWallpaper, preferencesFrom, protectedWallpaper, sortWallpapers, type Library, type Preferences, type Wallpaper } from '../domain.js';

export const DATABASE_NAME = 'dsh-gallery';
const META = 'wallpapers'; const IMAGES = 'images'; const SETTINGS = 'settings';
export interface SavedImage { entry: Wallpaper; blob: Blob }
export interface GalleryStorage {
  read(): Promise<Library>;
  image(id: string): Promise<Blob | undefined>;
  archive(images: SavedImage[]): Promise<void>;
  update(patch: Partial<Preferences>): Promise<void>;
  remove(id: string): Promise<void>;
  close(): void;
}
const result = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('无法读取本地图库'));
});
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error('无法保存图库，请检查设备存储空间'));
  tx.onerror = () => {}; // onabort carries the transaction's final error.
});

/** Images and metadata commit together; settings mutations read the latest cross-tab state. */
export class IndexedGalleryStorage implements GalleryStorage {
  private opened?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    return this.opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(META, { keyPath: 'id' });
        request.result.createObjectStore(IMAGES);
        request.result.createObjectStore(SETTINGS);
      };
      request.onerror = () => { this.opened = undefined; reject(request.error ?? new Error('无法打开本地图库')); };
      request.onblocked = () => { this.opened = undefined; reject(new Error('请关闭其他 DSH 标签页后重试')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.opened = undefined; };
        resolve(db);
      };
    });
  }
  async read(): Promise<Library> {
    const db = await this.open(); const tx = db.transaction([META, SETTINGS], 'readonly');
    const [entries, preferences] = await Promise.all([
      result<Wallpaper[]>(tx.objectStore(META).getAll()), result(tx.objectStore(SETTINGS).get('preferences')),
    ]);
    return { entries: sortWallpapers(entries), preferences: preferencesFrom(preferences) };
  }
  async image(id: string): Promise<Blob | undefined> {
    const db = await this.open();
    return result<Blob | undefined>(db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id));
  }
  async archive(images: SavedImage[]): Promise<void> {
    if (!images.length) return;
    const db = await this.open(); const tx = db.transaction([META, IMAGES], 'readwrite'); const done = completed(tx);
    for (const { entry, blob } of images) { tx.objectStore(META).put(entry); tx.objectStore(IMAGES).put(blob, entry.id); }
    await done;
  }
  async update(patch: Partial<Preferences>): Promise<void> {
    const db = await this.open(); const tx = db.transaction([META, IMAGES, SETTINGS], 'readwrite'); const done = completed(tx);
    try {
      const store = tx.objectStore(SETTINGS);
      const preferences = preferencesFrom(await result(store.get('preferences')));
      const next = preferencesFrom({ ...preferences, ...patch });
      if (next.selectedId !== null && (!await result(tx.objectStore(META).get(next.selectedId)) || !await result(tx.objectStore(IMAGES).get(next.selectedId)))) {
        throw new Error('这张图片已不在图库中，请刷新后重试');
      }
      store.put(next, 'preferences');
    } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
    await done;
  }
  async remove(id: string): Promise<void> {
    const db = await this.open(); const tx = db.transaction([META, IMAGES, SETTINGS], 'readwrite'); const done = completed(tx);
    try {
      const [entries, settings] = await Promise.all([
        result<Wallpaper[]>(tx.objectStore(META).getAll()), result(tx.objectStore(SETTINGS).get('preferences')),
      ]);
      const library = { entries: sortWallpapers(entries), preferences: preferencesFrom(settings) };
      if (protectedWallpaper(library, id) || currentWallpaper(library)?.id === id) throw new Error('请先切换壁纸，再删除这张图片');
      tx.objectStore(META).delete(id); tx.objectStore(IMAGES).delete(id);
    } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
    await done;
  }
  close(): void {
    void this.opened?.then(db => db.close(), () => {});
    this.opened = undefined;
  }
}
