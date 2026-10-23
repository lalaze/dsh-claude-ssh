import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MARKETS, currentWallpaper, protectedWallpaper, type Market, type Wallpaper } from '../domain.js';
import { type GalleryController } from './controller.js';
import { styles } from './styles.js';

type IconKind = 'gallery' | 'refresh' | 'upload' | 'search' | 'check' | 'trash' | 'close' | 'left' | 'right' | 'download' | 'plus' | 'minus';
export function Icon({ kind = 'gallery', size = 16 }: { kind?: IconKind; size?: number }) {
  const paths: Record<IconKind, React.ReactNode> = {
    gallery: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="16" cy="8" r="2" /><path d="m3 17 6-7 6 7 3-3 3 3" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8" /></>,
    upload: <><path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5" /></>, search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    check: <path d="m5 12 4 4L19 6" />, trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />, left: <path d="m15 5-7 7 7 7" />, right: <path d="m9 5 7 7-7 7" />,
    download: <path d="M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4" />, plus: <path d="M12 5v14M5 12h14" />, minus: <path d="M5 12h14" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
function useImage(controller: GalleryController, id?: string) {
  const [image, setImage] = useState<{ id: string; url: string; type: string }>();
  useEffect(() => {
    if (!id) return;
    let cancelled = false; let url: string | undefined;
    void controller.storage.image(id).then(blob => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob); setImage({ id, url, type: blob.type });
    }, error => { if (!cancelled) controller.reportError(error); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [controller, id]);
  return image?.id === id ? image : undefined;
}

function Card({ controller, entry, current, disabled, protected: locked, onPreview }: {
  controller: GalleryController; entry: Wallpaper; current: boolean; disabled: boolean; protected: boolean; onPreview(): void;
}) {
  const image = useImage(controller, entry.id);
  return <article className="gg-card" data-current={current} aria-label={entry.title}>
    <button className="gg-card-preview" aria-label={`预览 ${entry.title}`} onClick={onPreview} disabled={!image}>
      {image ? <img src={image.url} alt={entry.title} loading="lazy" /> : <span>正在读取图片…</span>}
    </button>
    {current && <span className="gg-card-badge"><Icon kind="check" size={11} />当前背景</span>}
    <div className="gg-card-info"><strong>{entry.title}</strong><p className="gg-card-date">{entry.date.slice(0, 10)}</p><p className="gg-card-copyright">{entry.copyright}</p></div>
    <div className="gg-card-actions">
      <button onClick={() => void controller.select(entry.id)} disabled={disabled || current} aria-label={`设为背景 ${entry.title}`}>{current ? '使用中' : '使用'}</button>
      <button onClick={() => void controller.remove(entry.id)} disabled={disabled || locked} aria-label={`删除 ${entry.title}`} title={locked ? '请先切换背景；最新每日壁纸会保留' : '从本设备图库删除'}>删除</button>
    </div>
  </article>;
}

function Lightbox({ controller, entries, id, onNavigate, onClose }: {
  controller: GalleryController; entries: Wallpaper[]; id: string; onNavigate(id: string): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closePreview = useRef(onClose); closePreview.current = onClose;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const index = entries.findIndex(e => e.id === id); const entry = entries[index];
  const image = useImage(controller, id); const [zoom, setZoom] = useState(1);
  const active = snapshot.preferences.enabled && currentWallpaper(snapshot)?.id === id;
  useEffect(() => {
    const node = dialog.current; if (!node) return;
    const previous = document.activeElement;
    node.showModal();
    const holdModalKeys = (event: KeyboardEvent) => {
      if (!node.open || !['Escape', 'Tab'].includes(event.key)) return;
      // Applying an image can disable the focused action, leaving focus on body.
      // Capture these keys there too, before the host Settings layer handles them.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closePreview.current(); }
      // Native dialog modality owns the default Tab traversal.
    };
    document.addEventListener('keydown', holdModalKeys, true);
    return () => {
      document.removeEventListener('keydown', holdModalKeys, true); node.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => { setZoom(1); }, [id]);
  const navigate = (direction: number) => { const next = entries[index + direction]; if (next) onNavigate(next.id); };
  if (!entry) return null;
  return createPortal(<dialog className="gg-lightbox" ref={dialog} aria-label={`图片预览：${entry.title}`}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
      // The host Settings dialog owns document-level Escape and Tab handlers.
      // Keep those keys in this native dialog so closing a preview keeps Settings open.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1); }
    }}>
    <style>{styles}</style>
    <div className="gg-lightbox-inner">
      <header className="gg-lightbox-head"><div><strong>{entry.title}</strong><span>{entry.date.slice(0, 10)} · {index + 1} / {entries.length}</span></div><div className="gg-actions">
        <div className="gg-lightbox-zoom"><button className="gg-icon-button" aria-label="缩小" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.25))}><Icon kind="minus" /></button><span>{Math.round(zoom * 100)}%</span><button className="gg-icon-button" aria-label="放大" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.25))}><Icon kind="plus" /></button></div>
        <button className="gg-icon-button" aria-label="关闭预览" autoFocus onClick={onClose}><Icon kind="close" /></button>
      </div></header>
      <div className="gg-lightbox-view">
        <button className="gg-icon-button gg-lightbox-nav gg-lightbox-prev" aria-label="上一张" disabled={index <= 0} onClick={() => navigate(-1)}><Icon kind="left" /></button>
        {image ? <div className="gg-lightbox-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}><img src={image.url} alt={entry.title} /></div> : <span role="status">正在读取图片…</span>}
        <button className="gg-icon-button gg-lightbox-nav gg-lightbox-next" aria-label="下一张" disabled={index >= entries.length - 1} onClick={() => navigate(1)}><Icon kind="right" /></button>
      </div>
      <footer className="gg-lightbox-bottom"><div><p>{entry.copyright}</p>{entry.copyrightUrl && <a href={entry.copyrightUrl} target="_blank" rel="noopener noreferrer">查看 Bing 图片来源 ↗</a>}</div><div className="gg-actions">
        {image && <a className="gg-button" href={image.url} download={`${entry.title.replace(/[\\/:*?"<>|]/g, '_')}.${image.type === 'image/webp' ? 'webp' : image.type === 'image/png' ? 'png' : 'jpg'}`}><Icon kind="download" />保存图片</a>}
        <button className="gg-button gg-primary" disabled={snapshot.busy || active || !image} onClick={() => void controller.select(id)}><Icon kind="check" />{active ? '正在使用' : '设为 DSH 背景'}</button>
      </div></footer>
    </div>
  </dialog>, document.body);
}

export function GalleryPage({ controller }: { controller: GalleryController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { entries, preferences, loading, busy, error } = snapshot;
  const [filter, setFilter] = useState<'all' | 'bing' | 'local'>('all'); const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(24); const [preview, setPreview] = useState<string>(); const upload = useRef<HTMLInputElement>(null);
  const current = currentWallpaper(snapshot); const currentImage = useImage(controller, current?.id);
  const displayed = entries.filter(e => (filter === 'all' || e.source === filter) && `${e.title} ${e.copyright} ${e.date}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => { setVisible(24); }, [filter, search]);
  const activeId = preferences.enabled ? current?.id : undefined;
  return <section className="dsh-gallery" aria-label="图库"><style>{styles}</style>
    <header className="gg-header"><div className="gg-heading"><span className="gg-mark"><Icon size={25} /></span><div><h2>图库</h2><p className="gg-hint">给 DSH 换一片风景</p></div></div><div className="gg-actions">
      <button className="gg-button" disabled={busy || loading} onClick={() => upload.current?.click()}><Icon kind="upload" />上传图片</button>
      <button className="gg-button" disabled={busy || loading} onClick={() => void controller.refresh()}><span className={busy ? 'gg-spin' : undefined}><Icon kind="refresh" /></span>{busy ? '处理中…' : '更新壁纸'}</button>
    </div></header>
    <input className="gg-hidden-input" type="file" ref={upload} aria-label="上传本地图片" accept="image/jpeg,image/png,image/webp" multiple onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
      if (files.length) void controller.upload(files);
    }} />
    {error && <div className="gg-notice" role="alert"><span>{error}</span><button className="gg-button" disabled={busy} onClick={() => void controller.refresh()}>重试更新</button></div>}
    <section className="gg-settings" aria-label="背景设置">
      <div className="gg-setting-main"><div><div className="gg-setting-title">使用图库背景</div><p className="gg-hint">在聊天和侧栏显示壁纸，设置仅用于当前设备。</p></div><button className="gg-toggle" role="switch" aria-label="使用图库背景" aria-checked={preferences.enabled} disabled={loading || busy} onClick={() => void controller.enable(!preferences.enabled)}><span /></button></div>
      {current && <div className="gg-current">{currentImage && <img className="gg-current-image" src={currentImage.url} alt="当前壁纸" />}<div className="gg-current-copy"><span className="gg-status"><i />{preferences.selectedId ? '已固定壁纸' : '每日自动更新'}{!preferences.enabled ? ' · 背景已关闭' : ''}</span><strong>{current.title}</strong><p>{preferences.selectedId ? '新壁纸仍会存入图库，不会替换当前图片。' : `${current.date.slice(0, 10)} · Bing 每日精选`}</p></div><button className="gg-button" disabled={busy} onClick={() => void (preferences.selectedId ? controller.resumeDaily() : controller.select(current.id))}>{preferences.selectedId ? '恢复每日' : '固定这张'}</button></div>}
      <details className="gg-appearance"><summary className="gg-hint" style={{ padding: '0 16px 12px', cursor: 'pointer' }}>背景效果与地区</summary><div className="gg-controls">
        <PreferenceSlider controller={controller} label="图片不透明度" name="opacity" value={preferences.opacity} max={100} unit="%" disabled={loading} />
        <PreferenceSlider controller={controller} label="背景模糊" name="blur" value={preferences.blur} max={24} unit="px" disabled={loading} />
        <label className="gg-region"><span>Bing 图片地区</span><select aria-label="Bing 图片地区" value={preferences.market} disabled={busy || loading} onChange={event => void controller.changeMarket(event.target.value as Market)}>{Object.entries(MARKETS).map(([market, label]) => <option value={market} key={market}>{label}</option>)}</select></label>
      </div></details>
    </section>
    <div className="gg-library-head"><nav className="gg-tabs" aria-label="图片来源">{([['all', '全部图片'], ['bing', 'Bing 每日'], ['local', '本地上传']] as const).map(([value, label]) => <button className="gg-tab" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<small>{value === 'all' ? entries.length : entries.filter(e => e.source === value).length}</small></button>)}</nav><label className="gg-search"><Icon kind="search" size={14} /><input aria-label="搜索图片" type="search" placeholder="搜索图片" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    {loading && <div className="gg-loading" role="status">正在读取本地图库…</div>}
    {!loading && busy && <div className="gg-loading" role="status">正在处理图片，请稍候…</div>}
    {!loading && displayed.length > 0 && <div className="gg-grid">{displayed.slice(0, visible).map(entry => <Card key={entry.id} controller={controller} entry={entry} current={activeId === entry.id} disabled={busy} protected={protectedWallpaper(snapshot, entry.id)} onPreview={() => setPreview(entry.id)} />)}</div>}
    {!loading && displayed.length === 0 && <div className="gg-empty" role="status"><Icon size={34} /><h3>{search ? '没有找到这张图片' : filter === 'local' ? '还没有本地图片' : '把喜欢的风景留在这里'}</h3><p>{search ? '换个名称或日期再试试。' : '更新最近 8 天的 Bing 壁纸，或上传自己的图片，设为 DSH 背景。'}</p>{!search && <button className="gg-button" disabled={busy} onClick={() => filter === 'local' ? upload.current?.click() : void controller.refresh()}>{filter === 'local' ? '上传图片' : '获取 Bing 壁纸'}</button>}</div>}
    {displayed.length > visible && <div className="gg-more"><button className="gg-button" onClick={() => setVisible(n => n + 24)}>加载更多 · 还有 {displayed.length - visible} 张</button></div>}
    <footer className="gg-footer"><span>图片保存在本设备，清除应用或网站数据会删除图库。</span>{preferences.lastSyncAt > 0 && <span>更新于 {new Date(preferences.lastSyncAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}</footer>
    {preview && displayed.some(e => e.id === preview) && <Lightbox controller={controller} entries={displayed} id={preview} onNavigate={setPreview} onClose={() => setPreview(undefined)} />}
  </section>;
}

function PreferenceSlider({ controller, label, name, value, max, unit, disabled }: {
  controller: GalleryController; label: string; name: 'opacity' | 'blur'; value: number; max: number; unit: string; disabled: boolean;
}) {
  const scale = name === 'opacity' ? 100 : 1;
  const [draft, setDraft] = useState(Math.round(value * scale));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setDraft(Math.round(value * scale)); }, [value, scale]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <label className="gg-range"><span>{label}<output>{draft}{unit}</output></span><input aria-label={label} type="range" min="0" max={max} step="1" value={draft} disabled={disabled} onChange={event => {
    const next = Number(event.target.value); setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void controller.update({ [name]: next / scale }); }, 120);
  }} /></label>;
}
