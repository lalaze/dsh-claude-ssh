import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, currentWallpaper, dailyWallpaper, preferencesFrom, protectedWallpaper, sortWallpapers, type Wallpaper } from '../src/domain.js';

const today: Wallpaper = { id: 'today', source: 'bing', title: '今日', date: '2026-10-23', copyright: '© Test', market: 'zh-CN' };
const yesterday: Wallpaper = { ...today, id: 'yesterday', date: '2026-10-22' };
const local: Wallpaper = { id: 'local-1', source: 'local', title: '我的照片', date: '2026-10-23T10:00:00Z', copyright: '本地上传' };
test('daily backgrounds follow the selected market; fixed backgrounds survive newer daily arrivals', () => {
  const library = { entries: sortWallpapers([yesterday, local, today]), preferences: { ...DEFAULT_PREFERENCES, enabled: true } };
  assert.equal(currentWallpaper(library)?.id, 'today'); assert.equal(dailyWallpaper(library)?.id, 'today');
  library.preferences.selectedId = 'yesterday'; assert.equal(currentWallpaper(library)?.id, 'yesterday');
  assert.equal(protectedWallpaper(library, 'yesterday'), true); assert.equal(protectedWallpaper(library, 'today'), true);
  assert.equal(protectedWallpaper(library, 'local-1'), false);
  library.preferences.selectedId = 'local-1'; assert.equal(currentWallpaper(library)?.id, 'local-1');
  library.preferences.selectedId = null; library.preferences.market = 'en-US';
  assert.equal(currentWallpaper(library)?.id, 'today'); // Keep the previous region's image until a new one is saved.
  library.entries.unshift({ ...today, id: 'us-today', market: 'en-US' });
  assert.equal(currentWallpaper(library)?.id, 'us-today');
});
test('damaged or older preferences cannot inject CSS values or enable an unrequested background', () => {
  assert.deepEqual(preferencesFrom(null), DEFAULT_PREFERENCES);
  const prefs = preferencesFrom({ opacity: -50, blur: 9999, market: '__proto__', enabled: 'true', lastSyncAt: NaN, selectedId: 3 });
  assert.equal(prefs.opacity, 0); assert.equal(prefs.blur, 24); assert.equal(prefs.market, 'zh-CN');
  assert.equal(prefs.enabled, false); assert.equal(prefs.selectedId, null); assert.equal(prefs.lastSyncAt, 0);
  assert.equal(preferencesFrom({ opacity: 'url(evil)', blur: Infinity }).opacity, 0.35);
});
