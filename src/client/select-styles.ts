// Scoped to this plugin. Colors follow DSH's public theme tokens in light/dark mode.
export const selectStyles = `
.dsh-ssh-select-root{display:inline-flex;min-width:0;vertical-align:middle}
.dsh-ssh-select-trigger{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;min-width:110px;min-height:36px;padding:7px 11px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:border-color .12s,box-shadow .12s,background .12s}
.dsh-ssh-select-trigger:hover:not(:disabled){border-color:var(--dsw-alias-border-l3,#9999);background:var(--dsw-alias-interactive-bg-hover,#8881)}
.dsh-ssh-select-trigger:focus-visible,.dsh-ssh-select-trigger[data-open=true]{outline:none;border-color:var(--dsw-focus-ring-color,#739de2);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,#739de2) 15%,transparent)}
.dsh-ssh-select-trigger:disabled{opacity:.45;cursor:default}
.dsh-ssh-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ssh-select-value[data-placeholder=true]{color:var(--dsw-alias-label-tertiary,#999)}
.dsh-ssh-select-leading{display:flex;flex:none;color:var(--dsw-alias-label-tertiary,#999)}
.dsh-ssh-select-chevron{display:flex;flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary,#999);transition:transform .12s}
.dsh-ssh-select-trigger[data-open=true] .dsh-ssh-select-chevron{transform:rotate(180deg)}
.dsh-ssh-select-panel{box-sizing:border-box;position:fixed;z-index:10000;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#282828);color:var(--dsw-alias-label-primary,#eee);box-shadow:0 12px 40px #0003,0 3px 10px #0002;font-family:inherit;font-size:13px;line-height:20px;padding:5px;animation:dsh-ssh-select-in .1s ease-out}
.dsh-ssh-select-search{display:flex;flex:none;align-items:center;gap:9px;padding:8px 8px 11px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l1,#8883);color:var(--dsw-alias-label-tertiary,#999)}
.dsh-ssh-select-search input{width:100%;min-width:0;border:0!important;border-radius:0;background:transparent!important;box-shadow:none!important;outline:none!important;padding:0;color:var(--dsw-alias-label-primary,#eee);font:inherit;line-height:22px}
.dsh-ssh-select-search input::placeholder{color:var(--dsw-alias-label-tertiary,#999)}
.dsh-ssh-select-search kbd{flex:none;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:4px;padding:0 4px;font:inherit;font-size:10px;line-height:16px;opacity:.8}
.dsh-ssh-select-list{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,#8886) transparent;padding:1px}
.dsh-ssh-select-option{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:36px;margin:1px 0;border-radius:7px;padding:7px 9px;cursor:pointer;user-select:none}
.dsh-ssh-select-option[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,#ffffff0d)}
.dsh-ssh-select-option[aria-selected=true]{color:var(--dsw-alias-label-primary,#eee);font-weight:500}
.dsh-ssh-select-check{display:flex;flex:none;color:var(--dsw-alias-state-business-primary,#8bb5f8)}
.dsh-ssh-select-empty{padding:25px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#999)}
.dsh-ssh-select-footer{display:flex;flex:none;justify-content:space-between;gap:16px;padding:8px 9px 3px;margin-top:5px;border-top:1px solid var(--dsw-alias-border-l1,#8883);color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:18px}
.dsh-ssh-select-hint{margin-left:8px}
@keyframes dsh-ssh-select-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.dsh-ssh-select-panel{animation:none}.dsh-ssh-select-trigger,.dsh-ssh-select-chevron{transition:none}}
`;
